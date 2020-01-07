const express = require('express') //引用express

const querystring = require('querystring')

const app = express() //构造express服务
const request = require('request')





//================
const os = require('os')
const localIp = getIPAdress()
const metaUrl = 'http://10.100.10.49:18080'
const appId = 'test'
configServices = []
var apolloConfig
//object
var notifications = {}
notifications['namespaceName'] = 'application'
notifications['notificationId'] = -1
//map
var remoteNotificationMessages = new Map()

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
            notifications['notificationId'] = result[0].notificationId
            let notificationMessage = new ApolloNotificationMessage(result[0].messages)
            remoteNotificationMessages.set('application', notificationMessage.details)
            resolve(notificationMessage)
        }
        if(!error && response.statusCode == 304) {
            resolve()
        }
        else {
            reject(new Error('ApolloError: doLongPollingRequest返回码不正确，返回码为' + response.statusCode))
        }
        
    })
  })
}

//http://10.100.10.52:18080//notifications/v2?cluster=default&appId=test&ip=10.2.10.38&notifications=%5B%7B%22namespaceName%22%3A%22application%22%2C%22notificationId%22%3A-1%7D%5D
//http://10.100.10.52:18080//notifications/v2?cluster=default&appId=test&ip=10.2.10.38&notifications=%5B%7B%22namespaceName%22%3A%22application%22%2C%22notificationId%22%3A96%7D%5D

async function longPolling() {
   return  new  Promise(async (resolve, reject) =>  {
    for(var i = 0; i < configServices.length; i++) {

      notificationsList = []
      notificationsList[0] = (notifications)
      let url = configServices[i] + '/notifications/v2?cluster=default&appId=' + appId + '&ip=' + localIp + '&notifications=' + querystring.escape(JSON.stringify(notificationsList))
      try {
          notificationMessage = await doLongPollingRequest(url).catch(err => {console.log(err.message); throw err})
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


function doPollingRequest(url) {
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
              console.log("configurations: " + JSON.stringify(newApolloConfig.configurations))
              resolve(newApolloConfig)
          }
          if(!error && response.statusCode == 304) {
              resolve()
          }
          else {
              reject(new Error('ApolloError: doLongPollingRequest返回码不正确，返回码为' + response.statusCode))
          }
        })
    })
}



//http://10.100.10.49:18080/services/config?appId=test&ip=10.2.10.38
async function polling(notificationMessage){
    return  new  Promise(async (resolve, reject) =>  {
    //循环configServices
    for(var i = 0; i < configServices.length; i++) {
        
        let url = configServices[i] + '/configs/' + appId + '/default/application?ip=' + localIp
        //longpoll后触发polling
        if(notificationMessage != undefined) {
            console.log('--- ' + JSON.stringify(notificationMessage.details))
            url = url + "&messages=" + querystring.escape(JSON.stringify(notificationMessage.details))
        }
        else if(remoteNotificationMessages.get('application') != undefined) {
            console.log('--- ' + JSON.stringify(remoteNotificationMessages.get('application')))

            url = url + "&messages=" + querystring.escape(JSON.stringify(remoteNotificationMessages.get('application')))
        }

        if(apolloConfig != undefined) {
            url = url + "&releaseKey=" + apolloConfig.releaseKey
        }
        try {

            let newApolloConfig = await doPollingRequest(url).catch(err => {console.log(err.message); throw err})
            resolve(newApolloConfig)
            break
        }
        catch(err) {
            if(i == configServices.length -1) {
                reject(err)
            }
            else {
                console.err('ApolloError: polling失败，' + err.message + ' 开始下一次polling')
                continue
            }
        }
    }
  })
  
}

//初始化
async function init() {
    configServices = await getConfigServices().catch(error => console.log(error.message))
    if(configServices != undefined && configServices.length > 0) {
        newApolloConfig = await polling().catch(error => console.log(error.message))
        if(newApolloConfig != undefined) {
            apolloConfig = newApolloConfig
            console.log('第一次短连接，本地apolloConfig缓存刷新')
        }
        //短连接循环，保证最终一致性
        setInterval(async ()=> {
            newApolloConfig = await polling().catch(error => console.log(error.message))
            if(newApolloConfig != undefined) {
              apolloConfig = newApolloConfig
              console.log('短连接，本地apolloConfig缓存刷新')
            }
        }, 1000 * 60)

        //长连接循环
        for(;;){
            notificationMessage = await longPolling()
            if(notificationMessage != undefined) {
              console.log('触发短连接')
              let newApolloConfig = await polling(notificationMessage).catch(error => console.log(error.message))
              if(newApolloConfig != undefined) {
                apolloConfig = newApolloConfig
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






