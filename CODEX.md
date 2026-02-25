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
