const express = require('express') //引用express

const querystring = require('querystring')

const app = express() //构造express服务
const request = require('request')





//================
//测试完毕这里改成300
const syncInterval = 30
const namespaces = ['adapterCaps', 'configs', 'renderConfig']
const os = require('os')
const metaUrl = 'http://10.100.10.48:8080'
const appId = 'CloudRendererAgent'
const localIp = getIPAdress()
configServices = []
//apolloconfig 缓存
var apolloConfigs = {}
var notifications = []
var remoteNotificationMessages = {}
var timeout = 1
var maxTimeout = 120
class ApolloConfig{
  constructor(appId, cluster, namepaceName, configurations, releaseKey){
      this.appId = appId
      this.cluster = cluster
      this.namepaceName = namepaceName
      this.configurations = configurations
      this.releaseKey = releaseKey
    }
}

class ApolloError {
  constructor(url, cause){
      this.url = url
      this.cause = cause
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
        let url = metaUrl + '/services/config?appId=' + appId
        request(url,function(error,response,body){
            if(!error && response.statusCode == 200){
                let configServices = []
                let results = JSON.parse(body)
                for(var  i = 0; i<results.length; i++) {
                  configServices.push(results[i].homepageUrl)
                }
                if(Object.keys(configServices).length == 0) {
                  apolloError = new ApolloError(url, '获取configServices失败，没有可用configServices')
                  reject(apolloError)
                }
                else {
                    resolve(configServices)
                }
            }

            else {
              apolloError = new ApolloError(url, '获取configServices失败,连接失败')
              reject(apolloError)
            }
        })
    })
}


function doLongPollingRequest(url) {
  return new Promise((resolve, reject) =>{
    request(url,function(error,response,body){
        if (error) {
            apolloError = new ApolloError(url, '推机制连接失败')
            reject(apolloError)
        }
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
            apolloError = new ApolloError(url, '推机制返回错误')
            reject(apolloError)
        }
        
    })
  })
}

//http://10.100.10.52:18080//notifications/v2?cluster=default&appId=test&ip=10.2.10.38&notifications=%5B%7B%22namespaceName%22%3A%22application%22%2C%22notificationId%22%3A-1%7D%5D
//http://10.100.10.52:18080//notifications/v2?cluster=default&appId=test&ip=10.2.10.38&notifications=%5B%7B%22namespaceName%22%3A%22application%22%2C%22notificationId%22%3A96%7D%5D
async function longPolling() {
   return new Promise(async (resolve, reject) =>  {
    setTimeout(async ()=> {
      for(var i = 0; i < configServices.length; i++) {
      //let url = configServices[i] + '/notifications/v2?cluster=default&appId=' + appId + '&ip=' + localIp + '&notifications=' + querystring.escape(JSON.stringify(notifications))
        let url = configServices[i] + '/notifications/v2?cluster=default&appId=' + appId + '&ip=' + localIp +  '&notifications=' + querystring.escape(JSON.stringify(notifications))
        try {
          let notificationMessage = await doLongPollingRequest(url).catch(err => {throw err})
          
          resolve(notificationMessage)
          //故障若恢复，等待步长重置
          timeout = 1
          break
        }
        catch(err) {
          if(i == configServices.length -1) {
              //避免由于apollo发生故障，无限轮询，解决方案
              //1、漏斗算法，固定时间窗口只能acquire 固定次数
              //2、每次发生问题，等待时间进行指数级增长
              //这里设计相对简单，等待时间增长n次
              timeout = (timeout << 1) < maxTimeout ? timeout << 1 : maxTimeout
              reject(err) 
          }
          else {
              console.error('ApolloError: longPolling失败, 由于有多个configService, 开始下一次longPolling')
              continue
          }
        }
      }
    }, timeout * 1000)


    
  })
}

async function  loopLongPolling() {
  for(;;) {
    let notificationMessages = await longPolling().catch(error => {
        console.error('Long polling failed, will retry in ' + timeout + ' seconds. appId: ' + appId + ' url: '+ error.url + ' cause(' + error.cause + ')')
    })
    if(notificationMessages != undefined && Object.keys(notificationMessages).length > 0) {
      console.log('推机制返回200，触发拉机制')
      let newApolloConfigs = await submitPolling(notificationMessages).catch(error => console.error(error))
      if(newApolloConfigs != undefined && Object.keys(newApolloConfigs).length != 0) {
        
        for(namespace in newApolloConfigs) {
          apolloConfigs[namespace] = newApolloConfigs[namespace]
          console.log('namespace: ' + namespace + '，configurations: ' + JSON.stringify(apolloConfigs[namespace].configurations))
        }
      }
    }
  }
}


function doPollingRequest(namespace, url) {
    return new Promise((resolve, reject) =>{
        request(url,function(error,response,body){
          if(error) {
            apolloError = new ApolloError(url, '拉机制连接失败')
            reject(apolloError)
          }
          if(!error && response.statusCode == 200){
              let result = JSON.parse(body)
              let appId = result.appId
              let cluster = result.cluster
              let namespaceName = result.namespaceName
              let configurations = result.configurations
              let releaseKey = result.releaseKey
              let newApolloConfig = new ApolloConfig(appId, cluster, namespaceName, configurations, releaseKey)
              resolve(newApolloConfig)
          }
          if(!error && response.statusCode == 304) {
              resolve()
          }
          else {
              apolloError = new ApolloError(url, '拉机制返回错误')
              reject(apolloError)
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
              url = url + "messages=" + querystring.escape(JSON.stringify(details))
              if(apolloConfigs[namespace] != undefined) {
                  url = url + "&releaseKey=" + apolloConfigs[namespace].releaseKey
              }
              try {
                  newApolloConfig = await doPollingRequest(namespace, url).catch(err => {throw err})
                  break
              }
              catch(err) {
                  if(j == configServices.length -1) {
                      throw err
                  }
                  else {
                      console.error('ApolloError: polling失败, 由于有多个configService, 开始下一次lpolling')
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
            console.log('sync polling, url: ' + url)

            try {
                newApolloConfig = await doPollingRequest(namespace, url).catch(err => {throw err})
                break
            }
            catch(err) {
                if(i == configServices.length -1) {
                    throw err
                    //reject(err)
                }
                else {
                    console.error('ApolloError: polling失败，由于有多个configService,开始下一次polling')
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
    configServices = await getConfigServices().catch(error => {
      console.error('启动连接apolloServer失败, url: ' + error.url + ' cause(' + error.cause + ')')
    })

    if(configServices != undefined && configServices.length > 0) {
        initNotifications()
        let newApolloConfigs = await selfPolling().catch(error => {
            console.error('第一次拉失败，cause(' + error.cause + ')')
        })
        if(newApolloConfigs != undefined && Object.keys(newApolloConfigs).length > 0) {
            apolloConfigs = newApolloConfigs
            
            for(namespace in newApolloConfigs) {
                apolloConfigs[namespace] = newApolloConfigs[namespace]
                console.log('namespace: ' + namespace + '，configurations: ' + JSON.stringify(apolloConfigs[namespace].configurations))
            }
            console.log('第一次拉成功，本地apolloConfigs缓存刷新')
        }
        else {
            console.error('连接失败了，记录错误！！！！！，使用本地文件！！！！')
        }
        //短连接循环，保证最终一致性
        setInterval(async ()=> {
            let newApolloConfigs = await selfPolling().catch(error => {
                console.error('sync polling failed, will retry appId: ' + appId + ' url: '+ error.url + ' cause(' + error.cause + ')')
            })
            if(newApolloConfigs != undefined && Object.keys(newApolloConfigs).length > 0) {
              //object的 key
              for(namespace in newApolloConfigs) {
                  apolloConfigs[namespace] = newApolloConfigs[namespace]
                  console.log('namespace: ' + namespace + '，configurations: ' + JSON.stringify(apolloConfigs[namespace].configurations))
              }
            }
        }, 1000 * syncInterval)

        //长连接循环
        loopLongPolling()
    }
    else {
      console.error('连接失败了，记录错误！！！！！，使用本地文件！！！！')
    }
}


 //启动监听3000端口
app.listen(3000,function(){
    console.log('Example app listening on port 3000!')
    
    init()
})






