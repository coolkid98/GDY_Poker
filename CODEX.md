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

## 10. 当前未完成项（必须继续）

1. 当前赖子仍采用“声明式定型”：
   1. 使用赖子时，客户端需提供 `declaredType` 与 `declaredKey`
   2. 尚未实现“服务端完全自动推导最佳赖子替代”
2. Redis 目前仅接入服务层，尚未把房间快照、会话、排行榜写入全链路。
3. PostgreSQL 尚未接入（`users`/`matches`/`match_players`/`match_events`）。
4. 托管超时策略尚未接入定时器执行。

## 11. 关键实现约定（防遗忘）

1. 服务端权威：客户端所有动作必须经后端确认后生效。
2. 幂等：`actionId` 已在房间层去重（重复 action 会返回 `DUPLICATE_ACTION`）。
3. 新一轮先手不可 `pass`（由 `TABLE_EMPTY_CANNOT_PASS` 拦截）。
4. 断线重连保留窗口：`30s`（Colyseus `allowReconnection`）。
5. 赖子相关当前协议约定：
   1. `play_cards` 支持 `declaredType`、`declaredKey` 字段
   2. 这两个字段将作为后续“赖子替代定型”的输入
   3. 若后续你希望改为“完全后端自动推导”，需在协议层删除该声明字段并改 RuleEngine

## 12. 下一阶段计划（阶段 2）

1. 引入回合超时与托管自动出牌。
2. 对接 Redis 房间快照与恢复。
3. 对接 PostgreSQL 战绩落库与事件流。
4. 评估是否改为“赖子自动定型”并移除前端声明字段。
