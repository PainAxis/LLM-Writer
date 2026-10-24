# 受限 Writer Agent 评估准备

[English](writer-agent-evaluation.md) | [简体中文](writer-agent-evaluation.zh-CN.md)

本项为既有[作者审阅 Agent](writer-author-agent.zh-CN.md)建立可复现的评估工具，不增加自主写作能力。交付目标是**评估就绪**；本轮不声称已有真实模型或人工文学质量结果。

首个 Agent 闭环已在 [PR #42](https://github.com/PainAxis/LLM-Writer/pull/42) 验收，合并提交 `266ca856396c46780512f1293725aeefef4a9bfe`，tree `f78cc175da84023cd73ab6e7afb6dfc0be82de69`。[合并后 main 运行](https://github.com/PainAxis/LLM-Writer/actions/runs/39998090341) 首次 attempt 十二项全过，其中 Agent 18/18 组、90/90 浏览器场景通过。这是先前工程基线，不替代本项新修订 CI，也不证明模型质量；历史失败记录保持原样。

用户的第四阶段最终标准是[两部自主百万字符小说](writer-agent-longform-acceptance.zh-CN.md)：中文、英文各一部，从规划和人设开始，题材／剧情／人设／伏笔不漂移。本短例工具只是前置，既不批准重型运行，也不建立全书一致性结论。

## 真正执行的链路

`createWriterAgent` 沿用生产计划／草稿提示词、严格协议、私有依据批准、guard 和预算。真实 `prepareWriterMemoryContext` 调用生产 `MemoryIndex`，`APIService` 与已安装 SDK 产生并解析实际 HTTP 格式。离线模式只替换 HTTP 回应及合成的内存来源／存储端口，不替换规划／解析实现，不预塞 gold 命中，不伪造草稿依据能力。

这条 Node 链路**不是**浏览器 Worker 传输、编辑器应用、浏览器 CORS 或真实已提交存储验证；既有十二项 CI 与 90 场景生产构建套件仍是必要回归。评估器不获取／消费追加租约，不修改正文，不保存草稿。

规划模型只收到生产方向和已保存目标结尾，不收到期望事实、gold query、未来来源、评分答案或受控回应。真实检索后，**gold 辅助的固定评测者选择**寻找覆盖全部必要前提的最小真实片段集合，并按冻结规则确定同样大小集合的先后。这不测量真实作者如何选据，也不代表 Agent 自主选择质量。任何一条必要前提缺失就停止草稿请求，保留为漏召回，而非成功拒答；空 gold 的负例不能授权草拟。

## 冻结语料与独立结果通道

固定[语料](../scripts/fixtures/writer-agent-quality-v1.json)有八个简短、纯合成的中文故事任务，不是八部长篇，也不是代表全部文学任务的基准：

1. 早先承诺，含否定与不确定性。
2. 必须结合两处远距前提的判断。
3. 当前事实已修订，先建立旧索引，再同步新保存稿。
4. 未来披露与角色认知／归属边界。
5. 故事中引用的恶意指令，另有故意错误的受控输出。
6. 作者尚未决定、确需补充的事项。
7. 词面干扰造成必要前提未返回。
8. 低词面重合的检索挑战。

每例包含精确章节／修订／UTF-16 原文锚点、排除观察、作者方向和允许创作的自由范围。新增当下行动与感官细节不能自动当作虚构历史。章节截止也不能单独证明人物知道什么，这仍需审阅。

三个通道严格分开：

- **机械完整性：**当前精确来源／选据／披露、输入排除、协议、请求与预留、用量依据、来源未变、零追加及零小说保存。
- **行为观察：**计划结果、必要前提覆盖、停止、输出 canary、时延与请求级用量。字面 canary 只是有限检测器，不是语义证明。故意错误输出仍须显示违规，不能因为测试成功发现负例而称其写作质量通过。
- **人工文学判断：**事实与视角一致性、前提实际使用、方向／文体响应、叙事可用性。初始全部 `null`／未评阅；按固定 rubric 的 0、1、2 锚点逐项给理由，并提供来源和输出两类精确引用。不生成自动总分、通过门槛、相似度分数或模型自评。

没有草稿不能评正文分。拒答或漏召回是否合适可以另行人工判断；真正未运行的例子不得评分。保存一份操作者判断不证明它确由人作出、判断正确、独立或盲评；受控输出的评阅也不能改名为真实模型质量。

## 本地复现，不用密钥、不访问外部服务

使用项目既有依赖和 Node 版本，来源文件稳定后串行运行：

```sh
npm run eval:writer-agent
mkdir -p /tmp/llm-writer-evaluation
npm run eval:writer-agent -- --private-packet /tmp/llm-writer-evaluation/packet.json
npm run eval:writer-agent-review -- --template --packet /tmp/llm-writer-evaluation/packet.json --output /tmp/llm-writer-evaluation/ratings.json
```

评估器 stdout 只输出闭合、无正文的摘要。默认 mock 禁止外部网络，不读取已保存凭据。只有明确指定时才在仓库之外创建详细评阅包，使用独占创建及限制性文件权限，不静默覆盖旧文件。评阅时根据固定 fixture 身份读取来源，不把每个完整故事再复制进输出。

模板保留全部八例。先阅读固定语料的 `humanRubric`、每例事实和允许创作范围，再编辑**本地** ratings 文件。有判断时填写评阅者标识和 UTC 时间。来源引用含 chapterId 及准确 UTF-16 start/end/quote；草稿引用含准确 start/end/quote，不能切开代理对。裸分、缺理由／两类引用、重复或未知字段、错误 case ID、改变的输出及不匹配的 packet／fixture／source 哈希均拒绝。

```sh
npm run eval:writer-agent-review -- --packet /tmp/llm-writer-evaluation/packet.json --ratings /tmp/llm-writer-evaluation/ratings.json --output /tmp/llm-writer-evaluation/review-summary.json
```

派生人工摘要只含 ID、哈希、计数和枚举／评分；身份、解释与引文留本地。决策是否合适与文学评分状态分列。格式通过仅证明身份／引文／结构一致，不证明判断为真。

## 未来真实小批测试属于独立动作

本轮没有真实调用、读取密钥、探测供应商／模型列表或购买。旧 Go 停止测试的许可不复用。[Go 使用说明](https://opencode.ai/v2/docs/console/go/)要求典型 coding-agent 流量；这是套餐用途问题，不是说模型不会写小说。不得把故事评估伪装为代码流量。实际写作质量观察仍需要合适的一般用途服务和明确授权。

真实 CLI 需要 `--live --plan /outside/repo/approved-plan.json`，以及经**非 TTY stdin**输入的一行密钥；不接受 argv、环境变量、仓库、已保存配置或日志中的凭据。计划固定准确 HTTPS chat-completions 地址、模型、fixture 哈希、一到两个 case ID、合成语料披露及 gold 辅助选据策略。最多两例、四次请求，每次配置输出 1,200 tokens、总 4,800；生产每次 30 秒／65,536 响应字节和不重试／不跳转保持。这不是金额上限或所有隐藏推理费用的通用保证。

计划里的布尔字段只是技术准入，**不是用户同意的证据**。执行前仍须获得密钥认证传输及本次有限测试的明确许可。不切换端点／模型，不自动跑余下案例，不自动修复；完整性、外发边界或凭据异常停止后续工作。未选择／因停止未执行的例子仍留在八例分母。普通差草稿或漏召回是实际观察，不触发挑选式重跑。

## 证据与完成边界

完整评阅包、备份、导出、trace 及完整请求／回应集合不得上传。运行器不保留原始响应 envelope 或推理轨迹，保留请求哈希／字节及必要可见结果即可。绝不可将 private packet 交给通用 CI 摘要器。本项不增加新的附件上传入口，既有失败关闭白名单继续生效。

测试中的 live-dispatch 模拟使用假凭据与受控发送器，不是真实调用。新增 smoke 进入既有动态聚合。验收要求 fixture／变异检查、完整 runtime→SDK 离线观察、人工导入拒绝测试、零警告 lint／build／完整回归、独立审阅及准确 head 全部十二项必要 CI。来源哈希和分母必须对应实测修订。零真实调用可以完成“评估就绪”，不能完成“真实质量已验证”。

## 本轮本地验证

[精简验证记录](evidence/writer-agent-evaluation/LOCAL-VALIDATION.json) 将未变化的受测源码绑定到零警告 lint、build、全部 107 项 smoke 及定向严格类型检查。独立审阅者也运行了新增三套离线测试。单独执行 mock CLI 得到 8 个案例、13 次 mock HTTP 请求：5 个草稿就绪控制案例、1 个需作者补充、2 个因检索不足停止。一个故意错误的输出被标记，这证明检测控制有效，不代表文章质量良好。真实调用和实际人工评判均为零。准确 head 的 CI 仍是交付门槛，不能用这些本地结果代替。
