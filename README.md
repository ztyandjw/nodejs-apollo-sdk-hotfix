# nodejs-apollo-sdk-hotfix
hotfix feature for nodejs using ctrip apollo config center


模拟java 客户端，完成nodejs 的热更新功能


通过推拉两种模式实现热更新，推模式维护长链接，服务端变动获取通知消息；拉模式为5分钟定期轮询，是一种最终一致性的方式



拉模式：

1、启动拉模式，本地落盘，更新缓存

2、每5分钟轮询，保证最终一致性



推模式：

1、循环进行推请求，服务端为异步servlet，DeferredResult实现，当60s后端没有更新，返回304，反之返回200，客户端记录notificationIdList，触发拉模式进行数据获取

2、若推模式接口发生问题，推模式客户端回进入无限轮询状态，那么需要保证如下两点

    a: 漏斗算法，时间窗口获取数量受限

    b: 每次发生错误，等待时间呈指数级增长



测试：

1、客户端启动，apollo关闭



客户端不再使用apollo，直接使用本地文件缓存



2、应用运行时，突然关停apollo



发现sync 轮询 间隔触发

发现long polling轮询等待时间会逐渐增长，逐渐增长到120s





3、恢复apollo，并且修改配置



客户端立刻感知到变动



5、禁止服务端longpolling机制，客户端syncPolling依然生效，并且只发生一次





