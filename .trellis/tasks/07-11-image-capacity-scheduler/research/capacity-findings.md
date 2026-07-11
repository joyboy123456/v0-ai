# 容量审计结论

* 服务器：4 vCPU、7.3GiB RAM、2GiB Swap、40GB 磁盘。
* 单 Next.js fork 进程空闲 RSS 约 750MB，历史发生过多 Node 进程叠加 OOM。
* 当前 `PHOTO_FISSION_CONCURRENCY=10` 是单任务并发，缺少全站上限。
* 上游只有老张一个渠道，配置为 6 个逻辑 provider；上游未对本项目设置并发限制。
* 5 人同时各跑多镜头时，现有代码可放大为几十个同时在途请求。
* 初始安全目标：全局 12、每用户 3、每逻辑 provider 2、大片任务 4、姿势任务 2，并按 RSS 动态降载。

