const express = require('express') //引用express

const querystring = require('querystring')

const app = express() //构造express服务
const request = require('request')





//================

const namespaces = ['application', 'fakeyou']
const os = require('os')
const localIp = getIPAdress()
const metaUrl = 'http://127.0.0.1:8080'
const appId = 'test'
configServices = []

//apolloconfig 缓存
var apolloConfigs = {}

var notifications = []

var remoteNotificationMessages = {}
// var remoteNotificationMessages = new Map()



class ApolloNotificationMessage {
  constructor(details){
        this.details = details
    }
}

class ApolloConfig{
  constructor(appId, cluster, namepaceName, configurations, releaseKey){
      this.appId = appId
      this.cluster = cluster
      this.namepaceName = namepaceName
      this.configurations = configurations
      this.releaseKey = releaseKey
    }
}

//================

//获取本地ip地址
function getIPAdress() {
    var interfaces = os.networkInterfaces();
    for (var devName in interfaces) {
        var iface = interfaces[devName];
        for (var i = 0; i < iface.length; i++) {
            var alias = iface[i];
            if (alias.family === 'IPv4' && alias.address !== '127.0.0.1' && !alias.internal) {
                return alias.address;
            }
        }
    }
}


//获取configServices
function getConfigServices() {
    return new Promise((resolve, reject) =>{
        let url = metaUrl + '/services/config?appId=' + appId + '&ip=' + localIp
        request(url,function(error,response,body){
            if(!error && response.statusCode == 200){
                let configServices = []
                let results = JSON.parse(body)
                for(var  i = 0; i<results.length; i++) {
                  configServices.push(results[i].homepageUrl)
                }
                resolve(configServices)
            }
            else {
              reject('ApolloError: 获取configServices失败')
            }
        })

    })
    
}


function doLongPollingRequest(url) {
  return new Promise((resolve, reject) =>{
    request(url,function(error,response,body){
        if (error) {
            reject(new Error('ApolloError: doLongPollingRequest无法连上apollo服务器'))
        }
          //console.log('long polling url ' + url)
        //console.log('long polling response ' + body + ' response code ' + response.statusCode)
        if(!error && response.statusCode == 200){
            let result = JSON.parse(body)
            //通知poll方法
            let notificationMessages = []
            for(var i =0; i < result.length; i++) {
                let notificationMessage = {}
                notificationMessage['details'] = result[i].messages
                notificationMessage['namespace'] = result[i].namespaceName
                notificationMessages.push(notificationMessage)
                //定时轮询，更新notificationId
                remoteNotificationMessages[result[i].namespaceName] = result[i].messages
                for(var j =0; j < notifications.length; j++) {
                  if(notifications[j]['namespaceName'] == result[i].namespaceName) {
                    notifications[j]['notificationId'] = result[i].notificationId
                  }
                }
            }
            resolve(notificationMessages)
        }
        if(!error && response.statusCode == 304) {
            resolve()
        }
        else {
            reject(new Error('ApolloError: doLongPollingRequest错误'))
        }
        
    })
  })
}

//http://10.100.10.52:18080//notifications/v2?cluster=default&appId=test&ip=10.2.10.38&notifications=%5B%7B%22namespaceName%22%3A%22application%22%2C%22notificationId%22%3A-1%7D%5D
//http://10.100.10.52:18080//notifications/v2?cluster=default&appId=test&ip=10.2.10.38&notifications=%5B%7B%22namespaceName%22%3A%22application%22%2C%22notificationId%22%3A96%7D%5D

async function longPolling() {
   return  new  Promise(async (resolve, reject) =>  {
    for(var i = 0; i < configServices.length; i++) {
      let url = configServices[i] + '/notifications/v2?cluster=default&appId=' + appId + '&ip=' + localIp + '&notifications=' + querystring.escape(JSON.stringify(notifications))


      try {
          let notificationMessage = await doLongPollingRequest(url).catch(err => {console.log(err.message); throw err})
          resolve(notificationMessage)
          break
      }
      catch(err) {
        if(i == configServices.length -1) {
            reject(err) 
        }
        else {
            console.err('ApolloError: longPolling失败，' + err.message + ' 开始下一次longPolling')
            continue
        }
      }
    }
  })
}


function doPollingRequest(namespace, url) {
    return new Promise((resolve, reject) =>{
        request(url,function(error,response,body){
          if(error) {
            reject(new Error('ApolloError: pollingDoRequest无法连上apollo服务器'))
          }
          if(!error && response.statusCode == 200){
              let result = JSON.parse(body)
              let appId = result.appId
              let cluster = result.cluster
              let namespaceName = result.namespaceName
              let configurations = result.configurations
              let releaseKey = result.releaseKey
              let newApolloConfig = new ApolloConfig(appId, cluster, namespaceName, configurations, releaseKey)
              console.log('namespace: '+ namespace + ' ;configurations: ' + JSON.stringify(newApolloConfig.configurations))
              resolve(newApolloConfig)
          }
          if(!error && response.statusCode == 304) {
              resolve()
          }
          else {
              reject(new Error('ApolloError: doLongPollingRequest错误'))
          }
        })
    })
}



//不是longPoll submit的
//http://10.100.10.49:18080/services/config?appId=test&ip=10.2.10.38
async function submitPolling(notificationMessages){
    return  new  Promise(async (resolve, reject) =>  {
    let configs = {}
    for(var i = 0; i < notificationMessages.length; i++) {
        let details = notificationMessages[i].details
        let namespace = notificationMessages[i].namespace
        try{
          let newApolloConfig
        //循环configServices
          for(var j = 0; j < configServices.length; j++) {
              
              let url = configServices[j] + '/configs/' + appId + '/default/' + namespace + '?ip=' + localIp
              url = url + "&messages=" + querystring.escape(JSON.stringify(details))
              if(apolloConfigs[namespace] != undefined) {
                  url = url + "&releaseKey=" + apolloConfigs[namespace].releaseKey
              }

              try {
                  newApolloConfig = await doPollingRequest(namespace, url).catch(err => {console.log(err.message); throw err})
                  break
              }
              catch(err) {
                  if(j == configServices.length -1) {
                      throw err
                      //reject(err)
                  }
                  else {
                      console.err('ApolloError: polling失败，' + err.message + ' 开始下一次polling')
                      continue
                  }
              }
          }
          if(newApolloConfig != undefined) {
              configs[namespace] = newApolloConfig
          }
          
          if(i == notificationMessages.length -1) {
              resolve(configs)
          }
        }
        catch(e) {
            console.log(e)
            reject(e)
            break   
        }
      
    }
  })
  
}

//不是longPoll submit的
//http://10.100.10.49:18080/services/config?appId=test&ip=10.2.10.38
async function selfPolling(){
    return  new  Promise(async (resolve, reject) =>  {
    let configs = {}
    for(var j = 0; j < namespaces.length; j++) {
      let namespace = namespaces[j]
      try{
        let newApolloConfig
      //循环configServices
        for(var i = 0; i < configServices.length; i++) {

            let url = configServices[i] + 'configs/' + appId + '/default/' + namespace + '?ip=' + localIp
            //longpoll后触发polling
            // if(notificationMessage != undefined) {
            //     url = url + "&messages=" + querystring.escape(JSON.stringify(notificationMessage.details))
            // }

            if(remoteNotificationMessages[namespace] != undefined) {

                url = url + "&messages=" + querystring.escape(JSON.stringify(remoteNotificationMessages[namespace]))
            }

            if(apolloConfigs[namespace] != undefined) {
                url = url + "&releaseKey=" + apolloConfigs[namespace].releaseKey
            }


            try {
                newApolloConfig = await doPollingRequest(namespace, url).catch(err => {console.log(err.message); throw err})
                break
            }
            catch(err) {
                if(i == configServices.length -1) {
                    throw err
                    //reject(err)
                }
                else {
                    console.err('ApolloError: polling失败，' + err.message + ' 开始下一次polling')
                    continue
                }
            }
        }
        if(newApolloConfig != undefined) {
            configs[namespace] = newApolloConfig
        }
        
        if(j == namespaces.length -1) {
            resolve(configs)
        }
      }
      catch(e) {
          console.log(e)
          reject(e)
          break   
      }
    }
  })
  
}

//因为不仅仅是默认的application命名空间，所以要初始化notifications
function initNotifications() {


    for(var i =0; i < namespaces.length; i++) {
      var notification = {}
      notification['namespaceName'] = namespaces[i]
      notification['notificationId'] = -1
      notifications.push(notification)
    }
    // notifications = [{'namespaceName' : 'application', 'notificationId': 5}, {'namespaceName' : 'fakeyou', 'notificationId': 6}]
}

//初始化
async function init() {
    configServices = await getConfigServices().catch(error => console.log(error.message))
    initNotifications()
    
    if(configServices != undefined && configServices.length > 0) {
        
        
        let newApolloConfigs = await selfPolling().catch(error => console.log(error.message))
        if(newApolloConfigs != undefined && Object.keys(newApolloConfigs).length > 0) {
            apolloConfigs = newApolloConfigs

            console.log('第一次短连接，本地apolloConfigs缓存刷新')
        }


        
        //短连接循环，保证最终一致性
        setInterval(async ()=> {
            let newApolloConfigs = await selfPolling().catch(error => console.log(error.message))
            if(newApolloConfigs != undefined && Object.keys(newApolloConfigs).length > 0) {
              //object的 key
              for(namespace in newApolloConfigs) {
                  apolloConfigs[namespace] = newApolloConfigs[namespace]
                  console.log('短连接，namespace: ' + namespace + '，本地apolloConfigs缓存刷新')
              }
            }
        }, 1000 * 7)

        //长连接循环
        for(;;){
            let notificationMessages = await longPolling()
            if(notificationMessages != undefined && Object.keys(notificationMessages).length > 0) {
              console.log('长连接变动，触发短连接')
              let newApolloConfigs = await submitPolling(notificationMessages).catch(error => console.log(error.message))
              if(newApolloConfigs != undefined && Object.keys(newApolloConfigs).length != 0) {
                
                for(namespace in newApolloConfigs) {
                  apolloConfigs[namespace] = newApolloConfigs[namespace]
                  console.log('短连接，namespace: ' + namespace + '，本地apolloConfigs缓存刷新')
                }
                console.log('长连接，引起本地apolloConfig缓存刷新')
              }
            }
            else {
              console.log('长连接，没有数据变更')
            }
        } 
    }
}


// function test() {
// return new Promise((resolve, reject) =>{
//     setInterval(()=> {
//         console.log('f')
//         resolve()
//     }, 5000)
    
//   })
// }


// function test(){

//   return new Promise((resolve, reject) =>{
//       reject(new Error('服务器连接失败'))
//   })
// }

// async function aa() {
//   await test().catch(error => console.log(error.message))
// }





 //启动监听3000端口
app.listen(3000,function(){
    console.log('Example app listening on port 3000!')
    init()

    		// setInterval(periodPolling,10000);
})






