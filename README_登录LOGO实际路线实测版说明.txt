智路哨兵登录LOGO实际路线实测版

本版按最新要求重做并测试：
1. 恢复登录，密码：123456。
2. 登录页和顶部 LOGO 已替换为你提供的智路哨兵 LOGO。
3. 车辆按照固定永川实际测试路线轨迹行驶，不再随机跑。
4. 手机端地图默认使用本地实际路线图，保证一定能显示。
5. 高德在线地图作为可选增强，加载失败不会影响地图页功能。
6. 首页、地图、预警、天气、数据、车辆切换、测试预警均可用。
7. 不依赖 CSV，不注册 Service Worker，减少 GitHub Pages 缓存问题。

GitHub Pages 上传：只需要上传 index.html 覆盖原来的 index.html。
访问：
https://liliqq13.github.io/zls-app/?v=login_logo_route_tested
或：
https://liliqq13.github.io/ZLS-app/?v=login_logo_route_tested

重要：如果必须让手机端高德真实底图加载，需要到高德开放平台，把 Web JS API 应用限制里的网站域名加入：
liliqq13.github.io
否则本版会自动使用本地实际路线图兜底。
