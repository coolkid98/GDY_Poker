# 干瞪眼 Web 项目开发方案（Colyseus + React + Redis）

## 1. 项目目标

1. 构建一个支持多人在线实时对战的干瞪眼 Web 游戏。
2. 完整支持：创建房间、加入房间、准备、发牌、出牌、过牌、摸牌、结算、再来一局。
3. 规则实现以 `GDY_RULES_FINAL.md`（V1.1）为唯一准则。

## 2. 技术选型

1. 前端：`React + TypeScript + Vite + Zustand + React Router`
2. 后端：`Node.js + TypeScript + Colyseus + Express`
3. 实时通信：`WebSocket`（通过 Colyseus 客户端/房间协议）
4. 数据库：
   1. `Redis`：在线会话、房间索引、短期对局状态、排行榜缓存
   2. `PostgreSQL`：用户数据、战绩、对局历史（持久化）
5. 部署：`Docker Compose`（开发与测试环境）

## 3. 代码目录规划

```
/frontend
/backend
```

后续建议补充：

```
/frontend/src
/backend/src
/backend/src/rooms
/backend/src/engine
/backend/src/services
/backend/src/db
```

## 4. 前端方案（React）

## 4.1 页面结构

1. 登录页（游客登录）
2. 大厅页（快速开始、创建房间、房间列表）
3. 房间页（玩家列表、准备状态）
4. 对局页（手牌区、桌面牌区、操作区、倒计时）
5. 结算页（排名、分数变化、继续游戏）

## 4.2 前端模块

1. `network`：Colyseus 连接、重连、事件订阅
2. `store`：房间状态、对局状态、用户状态
3. `ui`：卡牌组件、玩家位组件、操作栏组件
4. `rules-ui`：可出牌提示（仅提示，不做最终裁决）

## 4.3 前端关键约束

1. 客户端不做权威规则判定。
2. 所有操作经服务端确认后再更新关键状态。
3. 断线后自动重连并恢复房间态。

## 5. 后端方案（Colyseus）

## 5.1 Room 设计

1. `LobbyRoom`：大厅与匹配入口
2. `GdyRoom`：单局对战房间（核心）

## 5.2 GdyRoom 状态机

1. `WAITING`：等待玩家入房
2. `READY`：玩家准备阶段
3. `DEALING`：发牌
4. `PLAYING`：出牌阶段
5. `SETTLING`：结算阶段
6. `CLOSED`：房间结束

## 5.3 后端核心模块

1. `RuleEngine`：牌型识别、赖子替代、压制比较、胜负判定
2. `TurnManager`：回合推进、超时托管、pass 链闭环
3. `DeckManager`：两副牌构建、洗牌、发牌、摸牌
4. `SettlementService`：按剩余手牌计分、总分守恒检查
5. `ReconnectService`：断线保座与重连恢复
6. `PersistenceService`：对局与战绩入库

## 5.4 服务端消息建议

1. Client -> Server：`ready`、`play_cards`、`pass`、`trustee_on`、`trustee_off`
2. Server -> Client：`state_patch`、`action_result`、`turn_changed`、`settlement`、`reconnect_ok`

## 6. 数据库方案

## 6.1 Redis（实时态）

1. `gdy:room:{roomId}:state`：当前房间快照
2. `gdy:room:{roomId}:players`：玩家在线与座位状态
3. `gdy:user:{userId}:session`：连接信息与重连 token
4. `gdy:rank:daily`：日榜（ZSET）
5. `gdy:rank:weekly`：周榜（ZSET）

## 6.2 PostgreSQL（持久化）

1. `users`
   1. `id`、`nickname`、`created_at`
2. `matches`
   1. `id`、`room_id`、`started_at`、`ended_at`、`winner_user_id`
3. `match_players`
   1. `id`、`match_id`、`user_id`、`seat`、`final_score`、`remain_cards`
4. `match_events`
   1. `id`、`match_id`、`seq`、`event_type`、`payload_json`、`created_at`

## 7. 开发阶段

1. 阶段 1（基础骨架）
   1. 初始化 frontend/backend 工程
   2. 跑通 Colyseus 基础连接
2. 阶段 2（可对局 MVP）
   1. 完成 GdyRoom 状态机
   2. 完成核心规则引擎（按 V1.1）
3. 阶段 3（稳定性）
   1. 断线重连、超时托管
   2. Redis 房间态与排行榜
4. 阶段 4（数据化）
   1. PostgreSQL 战绩存储
   2. 对局事件回放数据

## 8. 验收标准

1. 任意房间可稳定完成一整局，且规则判定与文档一致。
2. 非法出牌请求 100% 被服务端拦截。
3. 断线重连后可恢复同一座位与手牌状态。
4. 单局结算满足分数守恒。

## 9. 开发记录（2026-02-25）

1. 已创建工程目录：
   1. `frontend`
   2. `backend`
   3. `docker-compose.yml`（Redis + PostgreSQL 本地依赖）
2. 已完成后端基础工程（`backend`）：
   1. `package.json`、`tsconfig.json`、`.env.example`
   2. Colyseus 启动入口：`backend/src/index.ts`
   3. 房间实现：`backend/src/rooms/gdy-room.ts`
   4. 状态 Schema：`backend/src/rooms/schema/gdy-state.ts`
   5. 发牌模块：`backend/src/engine/deck.ts`（2 副牌，含 4 王）
   6. 规则服务骨架：`backend/src/engine/rule-service.ts`
   7. Redis 连接服务：`backend/src/services/redis-service.ts`
   8. PostgreSQL 初始表结构草案：`backend/src/db/001_init.sql`
   9. 启动说明：`backend/README.md`
3. 已完成前端基础工程（`frontend`）：
   1. `package.json`、`vite.config.ts`、`tsconfig*`、`.env.example`
   2. React 路由：`frontend/src/App.tsx`
   3. 页面：`frontend/src/pages/LobbyPage.tsx`、`frontend/src/pages/RoomPage.tsx`
   4. Colyseus 客户端封装：`frontend/src/network/colyseus-client.ts`
   5. 状态管理：`frontend/src/store/use-game-store.ts`
   6. 手牌组件：`frontend/src/components/HandPanel.tsx`
   7. 启动说明：`frontend/README.md`
4. 当前已跑通的主流程（逻辑层）：
   1. 入房
   2. 准备
   3. 发牌（庄家 6，其他 5）
   4. 回合流转
   5. 出牌/过牌消息处理
   6. 无人压制后“出牌者摸 1 张并继续先手”
   7. 手牌出完触发结算（赢家 +sumN，其他 -N）
5. 当前消息事件（已实现）：
   1. Client -> Server：`ready`、`play_cards`、`pass`、`trustee_on`、`trustee_off`
   2. Server -> Client：`hand_dealt`、`hand_sync`、`draw_card`、`player_drew`、`played`、`passed`、`round_reset`、`settlement`、`action_result`
6. 依赖修复记录：
   1. 前端 `colyseus.js` 原版本 `^0.16.23` 不存在，已改为 `^0.16.0`
   2. 目的是避免 `npm ERR! ETARGET No matching version found`
7. 后端稳定性修复：
   1. `backend/src/services/redis-service.ts` 的 `ioredis` 导入从默认导入改为命名导入 `Redis`
   2. 目的：修复 TypeScript 构建错误与潜在运行时构造器异常
8. Colyseus Schema patch 崩溃修复：
   1. `backend/src/rooms/gdy-room.ts` 中不再重置 `lastPlay.cards = new ArraySchema(...)`
   2. 改为对现有 `ArraySchema` 原地 `splice + push`，避免丢失 childType 元数据
   3. 目的：修复 `TypeError: Cannot read properties of undefined (reading 'Symbol(Symbol.metadata)')`
9. Git 提交清理（2026-02-25）：
   1. 回退了包含 `node_modules`、`dist`、`.env` 的本地提交（未推送场景）
   2. 新增根目录 `.gitignore`，统一忽略依赖、构建产物、环境变量与缓存文件
   3. 重新生成干净提交：`6a335db`
10. Colyseus Join 崩溃修复（2026-02-25）：
   1. 将 `backend/tsconfig.json` 增加 `"useDefineForClassFields": false`
   2. 目的：保证 `@colyseus/schema` 的字段 setter 正常触发，防止集合字段丢失 childType 元数据
   3. 本地验证：使用 `colyseus.js` 脚本成功执行 `joinOrCreate('gdy_room')`，后端未再出现 `Symbol(Symbol.metadata)` 错误
11. 前端重复入房修复（2026-02-25）：
   1. 修复文件：`frontend/src/pages/RoomPage.tsx`
   2. 处理方式：组件卸载时自动执行 `leaveGameRoom()`；若 join 在卸载后返回则立即 `room.leave()`
   3. 目的：避免开发模式（React StrictMode 二次挂载）导致同一用户占用两个座位
12. 规则引擎与 UI 升级（2026-02-25）：
   1. `backend/src/engine/rule-service.ts` 重写为完整判型比较：
      1. 支持单张/对子/顺子/炸弹（3炸、4炸）
      2. 支持顺子边界（不含2、不循环、最长到QKA）
      3. 支持非炸弹“接力+1”与“2兜底压制”（顺子不允许2兜底）
      4. 支持炸弹比较（任意4炸 > 任意3炸，同炸弹类型比点数）
      5. 支持赖子声明校验（含纯赖子炸弹）
   2. `backend/src/rooms/gdy-room.ts` 已接入规则引擎结果，服务端统一落地 `declaredType/declaredKey`
   3. 前端房间页升级：
      1. 手牌显示改为可读牌面（如 `♣Q`、`小王`/`大王`）
      2. 仅在赖子出牌时展示牌型声明区
      3. 按回合状态自动禁用不可执行按钮
      4. 增加“上一手信息”与错误文案翻译
   4. 新增工具：`frontend/src/utils/cards.ts`（牌面解析、排序、花色样式）
13. 出牌/摸牌可视化动画（2026-02-25）：
   1. 后端事件增强：
      1. `played` 广播新增 `cards`（明牌数组），前端可直接渲染桌面出牌
      2. 新增 `player_drew` 广播（seat/deckCount/handCount），所有玩家可感知摸牌动作
   2. 前端动画升级（`frontend/src/pages/RoomPage.tsx` + `frontend/src/styles.css`）：
      1. 新增“桌面出牌区”，展示上一手的具体牌面（不是仅张数）
      2. 出牌时按牌序执行入场动画（逐张延迟）
      3. 摸牌时触发全局提示（`座位X摸1张`）与玩家行高亮脉冲
      4. 自己摸牌时，新增手牌按钮执行入场动画（便于确认新牌）
   3. 前端类型同步：
      1. `UiLastPlay` 新增 `cards: string[]`
      2. `HandPanel` 新增 `incomingCardId/incomingPulseTick` 动画入参
14. 赌桌化布局改造（2026-02-26）：
   1. 房间主界面改为“双栏”：
      1. 左侧为对局舞台（椭圆赌桌 + 环形座位）
      2. 右侧为独立玩家列表列（不再占整行）
   2. 新增“玩家已出牌可视化”：
      1. 每个座位卡片增加“最近出牌”缩略显示
      2. 赌桌中央下方增加“本轮出牌轨迹”（含出牌与过牌）
   3. 座位布局优化：
      1. 根据玩家数自动环形排布
      2. 自动旋转座位，使“我”优先落在下方观察位
   4. 样式与响应式：
      1. 新增 `battle-layout`、`arena-board`、`arena-table`、`players-sidebar` 等视觉模块
      2. 在窄屏下自动降级为单栏（先赌桌后玩家列表）
15. 日志可读性与再开一把（2026-02-26）：
   1. 事件日志升级为结构化渲染（`frontend/src/pages/RoomPage.tsx`）：
      1. 出牌/过牌/摸牌/结算/错误分类型渲染
      2. 出牌日志增加缩放扑克样式（迷你牌面）
      3. 座位文案统一为 `座位X（昵称）`
   2. 结算与离房文案增强：
      1. `本局结算，赢家 座位X（昵称）`
      2. `已离开房间：座位X（昵称）`
   3. 新增同房间再开一把按钮：
      1. 仅在 `READY` 阶段可触发，触发后发送 `ready=true`
      2. 按钮语义为“快速准备下一局”
16. 准备态强化与已出牌池（2026-02-26）：
   1. 玩家准备状态强化：
      1. 右侧玩家列表新增高亮 `已准备` 徽章（含视觉脉冲）
      2. 玩家卡片在 ready 后变更边框与底色，识别更醒目
      3. 场上座位卡同步添加 ready 高亮
   2. 事件日志区改为左右双栏：
      1. 左栏保留文本事件日志
      2. 右栏新增“已出牌可视化”，按时间累积展示本局所有已打出牌
      3. 每张牌展示来源座位与昵称，支持滚动查看历史
17. 文案与摸牌飞牌动画（2026-02-26）：
   1. 大厅标题文案从 `干瞪眼 Web` 调整为 `干瞪眼`
   2. 右下角面板标题从 `已出牌可视化` 调整为 `已出过的牌`
   3. 摸牌过场新增“飞牌到座位”动画：
      1. 触发源：`player_drew` 事件
      2. 动画路径：赌桌中心 -> 目标座位（按座位坐标计算）
      3. 与原有摸牌提示/高亮并行，不影响回合同步
18. 飞牌动画缺失修复与准备态显示策略（2026-02-26）：
   1. 修复飞牌动画被提前清空的问题：
      1. 根因：`player_drew` 后立即收到 `round_reset`，前端在 `round_reset` 中清空了 `drawFlights`
      2. 处理：移除 `round_reset` 中的 `setDrawFlights([])`，由飞牌计时器自行收尾
   2. 右侧玩家列表准备态优化：
      1. 准备徽章仅在 `WAITING/READY` 阶段展示
      2. 游戏开始后（`PLAYING` 等）不再显示“未准备”
19. 桌面出牌区座位卡优化（2026-02-26）：
   1. 对局中桌面座位卡隐藏准备字段：
      1. 仅在 `WAITING/READY` 阶段显示 `已准备/未准备`
      2. `PLAYING` 阶段不再出现“未准备”文案
   2. 当前回合文案优化：
      1. 当前回合座位卡主状态从“未出牌”切换为“出牌中”
      2. 增加“当前回合”提示小徽标
   3. 当前回合高亮增强：
      1. 座位卡边框/底色/阴影加强
      2. 状态条（`arena-seat-last`）采用深色高亮样式
20. 玩家列表文案精简与手牌图形化（2026-02-26）：
   1. 右侧玩家列表精简：
      1. 去掉每个玩家卡中的 `idle/online` 文本显示
      2. 保留核心信息（手牌数、分数、最近动作、已出牌统计）
   2. 桌面座位框手牌显示改造：
      1. 原“X张”数值改为“扑克牌背面”图形化展示
      2. 按手牌数量渲染卡背张数（最多显示12张，超出用 `+N` 标记）
      3. 小屏下自动缩小卡背尺寸，避免座位框溢出
21. 局域网手机入房连接修复（2026-02-26）：
   1. 问题根因：
      1. 前端 `VITE_COLYSEUS_ENDPOINT` 配置为 `ws://127.0.0.1:2567`
      2. 手机访问时会把 `127.0.0.1` 解析为手机本机，导致 `joinOrCreate` 无响应
   2. 代码修复（`frontend/src/network/colyseus-client.ts`）：
      1. 新增 endpoint 解析器：在浏览器环境下，若发现配置为 loopback 且页面 host 非 loopback，自动替换为页面 host
      2. 未配置 endpoint 时，默认按当前页面 host 自动拼接 `ws://<host>:2567`（https 页面使用 `wss`）
   3. 效果：
      1. 本机开发继续可用
      2. 局域网手机访问同一前端地址时可直接入房，无需手动改配置
22. 手机端布局适配强化（2026-02-26）：
   1. 桌面区适配：
      1. 调整移动端椭圆桌尺寸与高度，减少无效留白
      2. 缩小座位卡尺寸与内部字号，降低遮挡
      3. 小屏隐藏座位卡内“在线”字段，保留关键战斗信息
   2. 顶部操作区适配：
      1. 操作按钮改为双列栅格，避免拥挤换行错位
      2. 状态胶囊、标题、退出按钮缩放以适应窄屏
   3. 桌面轨迹与右侧信息适配：
      1. 本轮轨迹标签与胶囊缩小，减少与座位卡冲突
      2. 玩家侧栏、已出过的牌区域在手机端统一缩放
23. 手牌快捷操作与移动端并排布局（2026-02-26）：
   1. 手牌区新增快捷按钮：
      1. 在“我的手牌（仅本人可见）”区域上方新增 `过牌/出牌` 操作
      2. 与原顶部按钮共用同一套禁用条件与发送逻辑
   2. 移动端对局区布局策略调整：
      1. `battle-layout` 在手机端保持“桌面区 + 玩家列表”并排
      2. 不再在小屏降级为上下堆叠
      3. 为保证可读性，移动端同步压缩玩家侧栏字体与信息密度（隐藏次要行）
24. 移动端单屏固定与信息抽屉（2026-02-26）：
   1. 单屏策略：
      1. `RoomPage` 根容器改为移动端固定高度（`100svh`），主页面禁止纵向滚动
      2. 页面分为三行：顶部操作区 / 中部对局区 / 底部手牌区，均限制最小高度避免撑破视口
   2. 信息区抽屉化：
      1. 原底部“事件日志 + 已出过的牌”在手机端改为底部抽屉（`room-info`）
      2. 增加遮罩层、打开/关闭按钮与双 Tab（`日志` / `已出牌`）
      3. 抽屉关闭时不占主布局高度，保证战斗区始终可见
   3. 移动端密度优化：
      1. 顶部区域按钮与状态胶囊缩小，避免占用过多首屏空间
      2. 顶部重复的“过牌/出牌”按钮在手机端隐藏，仅保留手牌区快捷操作
      3. 桌面牌面、座位卡、玩家侧栏字体与间距继续下调，减少遮挡
25. 移动端“战斗信息”抽屉显示异常修复（2026-02-26）：
   1. 问题现象：
      1. 进入页面后抽屉默认显示
      2. 点击“关闭”无效
   2. 根因：
      1. `room-info` 继承了 `.panel` 的 `panel-in` 动画
      2. 该动画持续占用 `transform`，覆盖了抽屉的 `translateY` 开关
   3. 修复：
      1. 在移动端对 `room-info` 设置 `animation: none`
      2. 抽屉关闭态增加 `opacity: 0` 与 `pointer-events: none`
      3. 抽屉打开态恢复 `opacity: 1` 与 `pointer-events: auto`
26. 移动端组件尺寸二次压缩（2026-02-26）：
   1. 目标：
      1. 在“禁止页面上下滑动”前提下提升视觉协调性
      2. 缩小关键组件，减少桌面区和手牌区拥挤感
   2. 改动范围（`frontend/src/styles.css`）：
      1. `<=640px` 断点整体紧凑化：顶部操作区、状态胶囊、按钮、桌面牌区、座位卡、玩家侧栏、手牌卡片全部缩尺
      2. 新增 `<=430px` 次级断点：进一步压缩超窄屏设备上的字号与卡片尺寸
      3. 保持“桌面区 + 玩家列表并排”不变，仅做密度和尺寸优化
   3. 座位分布同步优化（`frontend/src/pages/RoomPage.tsx`）：
      1. 移动端环形座位半径收敛，避免顶部/底部座位卡过度贴边或遮挡
27. 桌面区改为容器驱动自适应布局（2026-02-26）：
   1. 问题背景：
      1. 仅靠断点和手动固定尺寸，部分手机尺寸下会出现座位框与桌面牌区错位/遮挡
   2. 实现（`frontend/src/pages/RoomPage.tsx`）：
      1. 给 `arena-board` 接入 `ResizeObserver`，实时读取容器宽高
      2. 新增 `computeArenaMetrics`：根据容器尺寸与玩家数量计算
         1. 座位卡宽度与缩放系数
         2. 椭圆桌宽高与垂直位置
         3. 座位环形半径（X/Y）
      3. `buildSeatLayout` 改为使用容器计算结果，不再依赖固定 viewport 分档半径
   3. 实现（`frontend/src/styles.css`）：
      1. `arena-table / table-card / trail / arena-seat` 尺寸改为读取 CSS 变量（由 JS 注入）
      2. 移除移动端对这些核心尺寸的硬编码覆盖，避免与动态计算相互冲突
      3. `players-sidebar` 增加 `container-type: inline-size`，并通过 container query 自动缩放玩家列表组件
28. 移动端桌面区占比与出牌居中优化（2026-02-26）：
   1. 桌面区横向占比提升：
      1. `<=640px` 下 `battle-layout` 右侧玩家列表列宽由 `minmax(108px, 31vw)` 调整为 `minmax(84px, 22vw)`
      2. `<=430px` 下进一步压缩为 `78px`
      3. 目的：把更多可视宽度让给左侧桌面出牌区
   2. 出牌动画居中：
      1. `table-cards` 增加 `justify-content: center`
      2. 移动端将桌面当前牌型文案居中（`.table-current .muted`）
      3. 目的：玩家打出的牌在视觉上稳定出现在桌面中心区域
29. 移动端虚线框内纵向居中与牌面缩放（2026-02-26）：
   1. 问题：
      1. 桌面出牌在纵向上偏下，不在虚线框中心
      2. 出牌牌面在手机端偏大
   2. 修复（`frontend/src/styles.css`）：
      1. `table-current` 改为 `position: relative + flex`，居中承载出牌
      2. 当前牌型文案 `table-current .muted` 改为绝对定位到虚线框顶部，不再挤占居中区域
      3. `table-current .table-cards` 增加顶部偏移，让牌组在虚线框中轴附近稳定居中
      4. 移动端 `--arena-card-scale` 从 `0.9` 下调为 `0.8`，整体缩小出牌牌面
30. 移动端座位框外扩防遮挡（2026-02-26）：
   1. 问题：
      1. 3人/4人局在手机端时，桌面座位框容易聚集在中部，遮挡虚线牌桌核心区域
   2. 修复（`frontend/src/pages/RoomPage.tsx`）：
      1. `computeArenaMetrics` 中上调移动端半径系数，减小 compact 造成的半径收缩
      2. 新增 `getPresetSeatAngles`：
         1. 3人局使用 `[90, 300, 240]`
         2. 4人局使用 `[90, 20, 290, 160]`
      3. `buildSeatLayout` 优先使用人数模板角度，确保头像框沿外缘分布，减少中区重叠
31. 赖子自动定型与炸弹动画（2026-02-27）：
   1. 赖子规则能力升级（`backend/src/engine/rule-service.ts`）：
      1. 出牌校验改为先解析上一手，再校验当前手
      2. 使用赖子时支持“后端自动推导牌型”，不再强制前端声明
      3. 若有上一手，则自动选择“能压过上一手的最小可行牌型”
      4. 若无上一手，则自动选择“最弱合法牌型”
      5. 仍保留声明能力；前端提供声明时以声明优先
   2. 前端赖子交互调整（`frontend/src/pages/RoomPage.tsx`）：
      1. 出牌禁用条件去掉“赖子必须声明”的硬限制
      2. 赖子声明字段保留为“可选输入”
      3. 发送 `play_cards` 时，仅在用户确实填写 `declaredKey` 时附带声明
   3. 炸弹过场动画（`frontend/src/pages/RoomPage.tsx` + `frontend/src/styles.css`）：
      1. 监听 `played` 消息中的 `declaredType === bomb`
      2. 在桌面出牌区中央触发一次炸弹闪光/冲击波/文字提示动画
      3. 动画自动收尾，并在发牌/清桌/结算阶段重置状态
32. 后端警告清理与“出光手牌”可视化（2026-02-27）：
   1. 后端 Colyseus deprecation 警告修复（`backend/src/rooms/gdy-room.ts`）：
      1. 全量替换 `this.send(client, ...)` 为 `client.send(...)`
      2. 启动日志不再刷 `DEPRECATION WARNING: use client.send(...)`
   2. 结算前后桌面动画保留（`frontend/src/pages/RoomPage.tsx`）：
      1. 状态同步时，只有在 `PLAYING` 且确实无上一手时才清空桌面牌
      2. 修复“最后一手打出后动画瞬间消失”的问题
   3. 新增“出牌飞向牌桌”过场（`frontend/src/pages/RoomPage.tsx` + `frontend/src/styles.css`）：
      1. 每次 `played` 按牌张数触发飞牌动画（座位 -> 桌面中心）
      2. 保留原桌面落牌动画，两者叠加提升反馈感
   4. 新增“出光手牌获胜”UI提示（`frontend/src/pages/RoomPage.tsx` + `frontend/src/styles.css`）：
      1. 结算时在桌面中央显示赢家提示条（含座位与昵称）
      2. 赢家座位卡短时高亮，减少玩家对胜者身份的歧义
33. PC端手牌快捷按钮位置微调（2026-02-27）：
   1. 调整 `frontend/src/styles.css` 中 `.hand-shortcuts`：
      1. 从 `justify-content: space-between` 改为 `justify-content: flex-start`
      2. 让“过牌/出牌”按钮靠左，贴近“手牌快捷操作”文案区域（位于“我的手牌”上方）
   2. 移动端保持不变：
      1. `<=640px` 断点下显式保留原有纵向/网格布局，仅重置 `margin-left`
34. 准备按钮状态反馈增强（2026-02-27）：
   1. 房间顶部“准备”按钮在本人已准备时改为 `已准备 ✅`（`frontend/src/pages/RoomPage.tsx`）
   2. 对应按钮增加高亮样式（绿色渐变+描边发光，`frontend/src/styles.css`）
   3. 目的：避免玩家点击准备后误以为未生效
35. 移动端桌面座位遮挡修复（2026-02-27）：
   1. 缩小移动端座位框（`frontend/src/pages/RoomPage.tsx`）：
      1. 在 `computeArenaMetrics` 中针对窄屏降低 `seatWidth` 基准与下限
      2. 结果：玩家框占位更小，不会压住桌面中心区域
   2. 拉开座位与牌桌距离（`frontend/src/pages/RoomPage.tsx`）：
      1. 移动端提高环形半径 `radiusX/radiusY`，并放宽边界 clamp（2%~98%）
      2. 同时缩小并下移椭圆牌桌（`tableWidth/tableHeight/tableTop`）让出安全间距
   3. 避免玩家框遮挡桌牌（`frontend/src/styles.css`）：
      1. 提升 `.arena-table` 层级到高于 `.arena-seat`
      2. 即使座位靠近桌缘，桌面中央牌型仍保持可见
36. 桌面视觉重做（去椭圆 + 半透明重叠美化，2026-02-27）：
   1. 移除椭圆桌面主体视觉（`frontend/src/styles.css`）：
      1. `.arena-table` 去掉椭圆边框/底色/阴影
      2. 保留“桌面出牌区”信息层，改为透明容器承载
   2. 中央出牌框改为玻璃态（`frontend/src/styles.css`）：
      1. `table-current` 使用半透明渐变 + 轻阴影 + 虚线边框
      2. 保持牌区可读性，同时减少厚重遮挡感
   3. 玩家框重叠可视化优化（`frontend/src/styles.css`）：
      1. `arena-seat` 改为半透明磨砂背景，并适度提高层级
      2. turn/ready 等状态保持高亮，但不再完全盖住下层内容
37. 移动端玩家头像框二次缩小（2026-02-27）：
   1. `computeArenaMetrics` 再次下调窄屏座位尺寸参数（`frontend/src/pages/RoomPage.tsx`）：
      1. `seatWidthFactor: 0.155 -> 0.145`
      2. `seatWidthCompactDelta: 0.03 -> 0.032`
      3. 窄屏最小宽度 `56 -> 52`
   2. 移动端样式缩放再收紧（`frontend/src/styles.css`）：
      1. `--arena-seat-scale` 乘数从 `0.9` 下调到 `0.82`
   3. 结果：移动端玩家框整体更小，遮挡概率进一步降低
38. 公网 Docker 一键部署文件（2026-02-27）：
   1. 新增后端镜像构建文件：`backend/Dockerfile`
   2. 新增前端镜像构建文件：`frontend/Dockerfile` + `frontend/nginx.conf`
   3. 新增生产编排：`deploy/docker-compose.prod.yml`
   4. 新增反向代理配置：`deploy/Caddyfile`（自动 HTTPS 证书）
   5. 新增部署环境模板：`deploy/.env.example`
   6. 新增部署文档：`deploy/README.md`
   7. 目标：云服务器拉代码后，通过 `docker compose ... up -d --build` 直接上线
39. Caddy 重启问题修复（2026-02-27）：
   1. 根因：`deploy/Caddyfile` 使用 `{$LETSENCRYPT_EMAIL}` / `{$GAME_DOMAIN}` / `{$API_DOMAIN}` 运行时变量
   2. `deploy/docker-compose.prod.yml` 的 `caddy` 服务未注入上述环境变量，导致配置为空并重启
   3. 修复：为 `caddy` 增加 `environment` 注入 3 个变量
   4. 结果：Caddy 可正确解析域名并保持常驻运行
40. 游戏音乐与音效接入（2026-02-28）：
   1. 新增前端音频引擎（`frontend/src/audio/game-audio.ts`）：
      1. 使用 Web Audio API（无额外依赖）实现
      2. 背景音乐：轻循环旋律（按节拍自动循环）
      3. 事件音效：摸牌音效、普通出牌音效、炸弹音效
      4. 增加本地偏好持久化：`localStorage(gdy_audio_enabled)`
   2. 房间页接入（`frontend/src/pages/RoomPage.tsx`）：
      1. 新增“音乐/音效 开/关”按钮
      2. 首次用户手势自动解锁音频上下文，避免移动端自动播放限制
      3. 在 `player_drew` 触发摸牌音效
      4. 在 `played` 触发出牌音效；炸弹牌型触发专属炸弹音效
   3. 样式补充（`frontend/src/styles.css`）：
      1. 新增音频按钮样式（开关态视觉区分）
41. 音效风格二次重做（2026-02-28）：
   1. 用户反馈首版音乐/音效体验一般，重做音频合成策略（`frontend/src/audio/game-audio.ts`）：
      1. 新增总线处理：`compressor + masterGain`，控制峰值与整体听感
      2. 背景音乐从“单线旋律”改为“和弦 Pad + 低音 + hi-hat 噪声节拍 + 主旋律”
      3. 摸牌音效改为“刷牌噪声 + 上行提示音”
      4. 出牌音效改为“卡牌落桌点击感 + 短音阶”，并按出牌张数增强力度
      5. 炸弹音效改为“冲击噪声 + 低频下坠 + 高频尾音”的爆炸感组合
   2. 保持原有 API 不变：
      1. `playDrawSfx / playCardSfx / playBombSfx`
      2. `startGameBackgroundMusic / stopGameBackgroundMusic`
      3. 房间页调用方无需改动
42. 摸牌/出牌音效三次优化（2026-02-28）：
   1. 根据反馈“背景音乐可接受，但出牌/摸牌不满意”，仅重做两类音效（`frontend/src/audio/game-audio.ts`）：
      1. 摸牌音效：改为“短刷牌噪声 + 轻提示音”，减少刺耳感并强化动作反馈
      2. 出牌音效：改为“落桌冲击 + 高频 snap”，并按出牌张数提高力度
      3. 多张出牌额外叠加低频层，让大牌组更有重量感
   2. 背景音乐逻辑保持不变（节拍、和弦、低音全部未调整）
43. 摸牌/出牌改为第三方包合成（2026-02-28）：
   1. 受网络限制无法本地 `npm install tone`，改为运行时动态加载第三方包：
      1. `Tone.js` CDN：`https://esm.sh/tone@15.0.4?bundle`
      2. 代码位置：`frontend/src/audio/game-audio.ts`
   2. 实现方式：
      1. 新增 `ensureToneReady()`，在用户手势解锁阶段加载并初始化 Tone 合成器
      2. 摸牌与出牌音效优先使用 Tone 触发（`playDrawWithTone` / `playCardWithTone`）
      3. 若 CDN 不可达，自动回退到现有本地 WebAudio 音效，保证功能可用
   3. 背景音乐与炸弹音效保持原逻辑不变
44. 修复“安装 tone 后仍无声音”的初始化阻塞（2026-02-28）：
   1. 根因：
      1. `game-audio.ts` 仍走 CDN 导入 `tone`，网络不稳定会卡住加载
      2. `unlock()` 等待 Tone 初始化，导致背景音乐与音效初始化链路被阻塞
   2. 修复：
      1. 改为从本地依赖动态导入：`import("tone")`
      2. `unlock()` 改为非阻塞触发 Tone 预热，不再等待第三方加载完成
   3. 结果：
      1. 背景音乐可立即按原逻辑启动
      2. 出牌/摸牌优先使用 Tone，初始化失败时仍有本地兜底音效
45. 修复 Tone 在 dev 环境不生效（2026-02-28）：
   1. 触发症状：
      1. 前端无背景音乐与出牌/摸牌音效
      2. Vite 告警：`import(TONE_MODULE_NAME)` 无法静态分析
   2. 根因：
      1. 运行时变量动态导入导致 Vite 无法稳定处理依赖优化
      2. Tone 初始化链路异步过深，容易脱离用户手势上下文
   3. 修复（`frontend/src/audio/game-audio.ts`）：
      1. 改为静态引入：`import * as Tone from "tone"`
      2. `ensureToneReady()` 改为同步创建 Tone 节点
      3. 在 `unlock()` 的用户手势阶段执行 `await Tone.start()`
      4. `playDraw/playCard` 继续保留本地 WebAudio 兜底
   4. 结果：
      1. Vite 不再出现动态导入分析告警
      2. 本地 `tone` 依赖可被正常预构建并在前台生效
46. 背景音乐切 Tone + 进房即播放（2026-02-28）：
   1. 背景音乐实现改为 Tone（`frontend/src/audio/game-audio.ts`）：
      1. 新增 Tone 背景音乐轨道：Pad / Bass / Lead / Hat
      2. 使用 `Tone.Loop + Tone.Transport` 驱动循环节拍
      3. 启动逻辑改为 Tone 优先，保留旧 WebAudio 定时器作为兜底
   2. “进入房间即听到音乐”处理（`frontend/src/pages/LobbyPage.tsx`）：
      1. 点击“进入房间”时先执行 `unlockGameAudio()`（绑定用户手势）
      2. 音频开关为开启时，立即触发 `startGameBackgroundMusic()`
      3. 进入 Room 页面后无需等待“全员准备/开局”即可有 BGM
47. BGM 欢快风格优化（2026-02-28）：
   1. Tone 背景音乐重新编排（`frontend/src/audio/game-audio.ts`）：
      1. 速度上调：`BPM 104 -> 126`
      2. 和弦进行改为更明亮的 `Cmaj7 -> G7 -> Am7 -> Fmaj7`
      3. Lead 改为更跳跃的分段旋律（8 分音符步进）
      4. Bass 改为“主拍根音 + 反拍五度”增强律动
      5. Hat 改为 offbeat 强拍并增加细分补点，听感更活泼
   2. 音色参数调亮：
      1. Pad：`triangle -> sawtooth`，缩短释放，减少拖尾
      2. Lead：更快攻击与更短释放，增强颗粒感
      3. Bus 滤波截止上调，混响衰减与湿度下调，整体更清爽
48. BGM 改为“可爱/电子/街机”风格（2026-02-28）：
   1. Tone 背景音色重构（`frontend/src/audio/game-audio.ts`）：
      1. 新增 `Chorus + BitCrusher`，加入轻微 8-bit 颗粒感
      2. Pad/Bass/Lead 统一偏方波系音色（更街机）
      3. 新增独立 `Arp` 轨道，提升电子感与可爱跳跃感
   2. 编排重构：
      1. BPM 上调到 `132`
      2. 和弦改为大三和弦主循环（C / G / Am / F）
      3. 16 步循环中加入高音琶音与反拍主旋律 Hook
      4. Bass 改为根音/八度切换，Hat 保留反拍并轻补点
   3. 听感目标：
      1. 减少“过于欢快偏流行”的感觉
      2. 强化“可爱 + 电子 + 街机”氛围
49. BGM 细化为“任天堂/像素风 + 软萌”混合（2026-02-28）：
   1. 音色微调（`frontend/src/audio/game-audio.ts`）：
      1. Bus 效果链更轻：降低混响/合唱深度，BitCrusher 降低到轻度着色
      2. Pad/Bass 改回更温和的 `triangle` 主体，Lead/Arp 保持像素短包络
      3. 目标是“像素颗粒感”保留，同时减少尖锐感，听起来更软萌
   2. 编排重构：
      1. 和声改为 `C -> Am -> F -> G`（更典型任天堂系循环）
      2. 16 分音符步进、64 步循环，加入主旋律 Hook 与结尾小跳音
      3. Bass 使用“根音/八度/五度”模式，Hat 以反拍为主并在小节末补点
   3. 节奏设定：
      1. BPM 固定为 `128`，保持轻快但不过躁
50. BGM 速度下调（2026-02-28）：
   1. 用户反馈“节奏太快”，在不改音色与编排前提下仅调速
   2. `Tone.Transport.bpm` 从 `128` 下调到 `114`（`frontend/src/audio/game-audio.ts`）
   3. 结果：整体更舒缓，仍保留像素风节拍感
51. 规则修复：禁止单出赖子（2026-02-28）：
   1. 问题：在特定路径下，玩家可单独打出大小王（赖子），与规则不符
   2. 后端修复（`backend/src/engine/rule-service.ts`）：
      1. 在 `evaluatePlay` 增加统一硬校验：
      2. `cards.length === 1 && hasWildcard` 时直接返回 `WILDCARD_SINGLE_FORBIDDEN`
      3. 覆盖自动推导和声明牌型两条路径，避免绕过
   3. 前端提示（`frontend/src/pages/RoomPage.tsx`）：
      1. 新增错误文案映射：`WILDCARD_SINGLE_FORBIDDEN -> 赖子（大小王）不能单出，必须和其他牌组合`
   4. 构建验证：
      1. `backend npm run build` 通过
      2. `frontend npm run build` 通过

## 10. 当前未完成项（必须继续）

1. Redis 目前仅接入服务层，尚未把房间快照、会话、排行榜写入全链路。
2. PostgreSQL 尚未接入（`users`/`matches`/`match_players`/`match_events`）。
3. 托管超时策略尚未接入定时器执行。

## 11. 关键实现约定（防遗忘）

1. 服务端权威：客户端所有动作必须经后端确认后生效。
2. 幂等：`actionId` 已在房间层去重（重复 action 会返回 `DUPLICATE_ACTION`）。
3. 新一轮先手不可 `pass`（由 `TABLE_EMPTY_CANNOT_PASS` 拦截）。
4. 断线重连保留窗口：`30s`（Colyseus `allowReconnection`）。
5. 赖子相关当前协议约定：
   1. `play_cards` 仍支持 `declaredType`、`declaredKey` 字段（可选）
   2. 后端已支持“无声明自动定型”；有声明时以声明为准
   3. 前端仅在用户填写 `declaredKey` 时发送声明字段

## 12. 下一阶段计划（阶段 2）

1. 引入回合超时与托管自动出牌。
2. 对接 Redis 房间快照与恢复。
3. 对接 PostgreSQL 战绩落库与事件流。
4. 补充赖子出牌的前端智能提示（可选声明建议、可压提示）。
