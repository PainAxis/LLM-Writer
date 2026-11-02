# OpenCode Go：有界 Node pilot

[English](writer-creative-go-pilot.md) | [简体中文](writer-creative-go-pilot.zh-CN.md)

Go 接入复用 Creative Pilot v4 的 repository、compiler 和九任务 engine，不替换 [PR #53](https://github.com/PainAxis/LLM-Writer/pull/53) 已验收的 OpenAI 浏览器入口。工程测试拦截供应商流量，不产生真实模型写作结果。

## 供应商合同

- 供应商 OpenCode Go，模型 `mimo-v2.6-flash`。
- 固定 base URL `https://opencode.ai/inference/go/openai/v1`，仅 Chat Completions。
- 每项 campaign 使用稳定 session header，真实标识 LLM-Writer 的 User-Agent。浏览器可能丢弃自定义 User-Agent，因此此入口使用 Node。
- 关闭 thinking，单次最多 4,096 输出 tokens，无工具、自动重试或余额供应商 fallback。
- 独立哈希绑定的 Go grant 和 policy；既有 OpenAI 与离线记录保持原语义。

[Go 文档](https://opencode.ai/v2/docs/console/go/) 在 2026-11-02 列出的输入／输出单价为每百万 $0.14／$0.28。[MiMo 规格](https://mimo.mi.com/models/en-US/mimo-v2.6-flash)及[官方模型配置](https://huggingface.co/XiaomiMiMo/MiMo-V2.6-Flash-RL/raw/main/config.json)提供 1,048,576-token 上下文上界。按完整输入上界加 4,096 输出逐请求向上取整预留，得到**每槽 $0.147948，18 槽合计 $2.663064**。这不是预计实际消耗；既有 HTTP 字节限制不冒充 token 限制。

Go 的订阅额度消耗与现金扣款分开记录。保留的供应商证据区分 `cost`、`billing_source`、`allowance` 和 `list_cost`；计费证据缺失或不一致会阻止接纳与后续生成。[计费字段定义](https://opencode.ai/v2/docs/console/api/inference/)。

## 真实执行前

1. 通过进程环境提供当前已授权 Go 凭据，不放在命令参数、仓库、报告或 campaign 中。
2. 本次执行明确确认账户 **Extra Usage 已关闭**。否则 Go 额度用尽后可能扣余额；固定 Go URL 和事后的零费用响应均不能证明该开关状态。
3. 确认此工作负载符合 Go 的 coding-agent 用途条款。如实标识客户端，不把小说流量伪装成编程请求。
4. 使用两份虚构、非敏感简报，输出目录设在仓库外。准备阶段只在本地执行且零调用；显式执行先做一个任务，检查保留结果后再提高任务上限。

账户余量与模型可用性须针对实际账户核对；公开套餐上限不等于剩余额度。这些条件未解决时，不声称已完成真实试跑。

## 真实运行后的质量审查

实际简报、规划、响应与正文保留在私有目录，对外只发布有界、无正文的聚合信息。中英文分别检查：

- 六份规划与三章均通过编译，完整前章正文进入后续上下文。
- 各章遵循章纲、时间线、人物知识与明确限制。
- 伏笔与回收保持一致；矛盾附私有精确引用。
- 明确由人工或另行标识的审阅者评价文笔、情节推进与人物声音。
- 完成、失败、未知与未运行任务分别报告，订阅额度与现金费用分别报告。

单个规划响应被接纳，只建立连通性／结构观察，不代表三章质量验收。中英文三章通过也不等于两部百万字符小说验收。

## 命令

先准备并检查私有 preview（不需密钥，零模型调用）：

```sh
npm run pilot:go -- --state-dir /absolute/private/pilot-state \
  --confirm-extra-usage-off --confirm-transmission --max-usd 2.663064
```

核对上方前置条件后，通过既有受保护进程环境提供凭据，显式执行一个中文任务：

```sh
npm run pilot:go -- --state-dir /absolute/private/pilot-state \
  --execute --language zh --max-tasks 1 \
  --confirm-extra-usage-off --confirm-transmission --max-usd 2.663064
```

凭据变量为 `OPENCODE_GO_API_KEY`，其值不应出现在命令示例中。续跑使用同一 state 目录；下一次调用前检查保留结果。`--language en` 选择已配对英文 campaign。每次默认推进一个任务，各语言终身上限仍为九次。遗留执行锁须先检查，不自动删除后重放。保留的是模型响应正文及规范化计费元数据，不是完整 HTTP 响应字节。
