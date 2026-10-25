# Campaign 存储分配与结算

[English](writer-campaign-storage.md) | [简体中文](writer-campaign-storage.zh-CN.md)

状态：PR #45 合并前通过全部 13 项任务及中英文原生 IDB 百万字符测试；但同树主分支后续运行中，Node 中文在 966,686 字符处超时，原生测试再次通过。[聚焦 CPU 修正及保留失败](testing/writer-campaign-cpu-2026-10-25/REPORT.zh-CN.md)仍未关闭门槛：PR #46 main run 40170296500 的 Node 中文在同一前缀再次超时。新增 [action 私有验证证明](writer-campaign-action-proof.zh-CN.md)保留完整历史 IO 与 raw 精确比较，最终源码 profile 及全部 13 项 CI 均为 NOT RUN。下方描述和本地测量记录 proof 之前的实现，保持原样；不是自主小说或文学验收。

前一项[持久化基础](writer-campaign-foundation.zh-CN.md)已由 PR #44 验收，合并提交 `84e704afff08921763d4b83136d881a39946900a`，tree `cc53d33565ff574fd6bbce2f76bdcca9aecda406`。[main run 40154748857](https://github.com/PainAxis/LLM-Writer/actions/runs/40154748857) 十二项全部通过，含作者 Agent 90 场景及 Campaign 12 场景；这些结果不替代新记账实现的验证。

## 范围与不变边界

本项修正永久累加最坏存储预留造成的容量限制，不提高 67,108,864 字节上限、不删除历史完整性检查、不授权真实供应商，也不增加自主小说生成。Campaign 与普通 Writer 保存、事实图谱、API 设置和普通备份隔离。`/#/campaigns` 是离线 QA 界面，打开或恢复不自动派发。

最终标准仍是中文、英文各一部，各 1,000,000 正文字符，从规划到写作自主完成，并独立核验全书题材、剧情、人设及暗线伏笔不漂移。重复合成字符仅用于存储几何，不是写作质量、创造性或无漂移证据；见[长篇验收合同](writer-agent-longform-acceptance.zh-CN.md)。

## 有版本的精确记账

新 campaign 使用 schema/protocol v2。旧 v1 保留原完整性校验，仅可查看，不在磁盘重写、迁移、归一化或重新计算可用额度；即使伪造当前 runtime identity，也不能使 v1 获得写权限。未知版本和损坏记录拒绝并保留原字节。

以下三项含义不同：

- **W：**成功持久提交的累计 UTF-8 key + value 字节，每次覆盖 head 仍再次计入，永不减少。
- **U：**全部未结请求 allocation 的剩余未来写入义务，包含已从当前候选／任务索引脱离的旧请求。
- **P：**剩余受保护恢复空间，初始 524,288 字节，纳入同一上限，不是额外容量。

每个已提交状态都满足 `W + U + P <= 67,108,864`。当前保留 map 大小、累计写入、浏览器物理配额和供应商账单是不同指标。结算或取消均不删除历史记录，也不保证浏览器物理可用性。

每个请求的 allowance 与身份不可变。实际请求阶段写入增加 W，并等额消耗自身 allowance，因此单纯消耗不腾出容量。只有将该精确保留响应成功接受为 artifact，才能在同一次 CAS 中释放剩余额度；请求修订、artifact、任务可用性、正文字数、checkpoint、receipt 与结算原子提交。

未知、失败、取消及被替换请求不退款。旧请求的 open allocation 独立保留，不随活动任务引用消失。open 索引最多 128 行，第 129 个未结 allocation 在新增 reserve/intent 前拒绝；这不承诺 128 个最大请求可同时放入。历史操作和尝试数仍有各自有限上限。

读取时从不可变 receipt 重建分配、消耗、释放及剩余总量，并核对 checkpoint 索引。活动任务未变化并不能证明没有历史义务。精确 receipt 重放不再写入或释放；旧 operation ID 携带不同业务内容会拒绝。ACK 丢失仍是未知，直到 receipt／fence 证据确立实际结果；仅保存恢复不再调用供应商。

## 有界字节表示与预留证明

所有持久化存储字节字段使用严格 16 位 ASCII 十进制字符串，只按 safe integer 及唯一规范表示解码。仓库先冻结记录形状与身份，以定宽占位计量，填入计算后的计数和哈希，再独立重算最终 key/value 字节；最终大小须与计费量一致，随后才能 CAS。

变长的写入量 x 与剩余量 100-x 会引出真实循环：`f(x)=87+digits(x)+digits(100-x)` 在 90 与 91 之间来回，即使容量足够，有限迭代也可能拒绝合法结算。全部反馈字段与哈希定宽后，固定合法形状的大小函数为常量；数组成员、key、字段存在性不能依赖猜测的写入量。

最长请求写入链是 reserve → intent → 可选 unknown → retain → accept：五次 request/checkpoint/receipt/head，最后另写一个 artifact。仅 retained/committed 请求携带响应，artifact 是第三份持久化正文。通用 reconcile 不得追加任意请求阶段或混批不同 allocation。

初始保守 allowance 为 `A = 5M + 5Q + 3X + G`：

- `M = 16,384 + 1,024*T + 512*128`，始终覆盖未来最大任务和 open 索引下的完整元数据事务。
- `Q = 8,192 + S`，S 为 `JSON.stringify(preparedInput)` 的精确 UTF-8 大小，包括已组装输入文档再次作为字符串存储的外层编码。
- `X = 6*R + 2`，覆盖 UTF-8 上限 R 的未知响应及 JSON 转义。
- `G = 4,096 + 256*T`，覆盖 artifact 元数据及依赖引用。

T <= 128、输入／响应上限各 65,536 字节时，整个生命周期 allowance 最多 4,288,528 字节。单个 value 的保守上界为 request 794,628、artifact 430,082、checkpoint 212,992 字节，低于不变的 1 MiB 单记录上限。多记录事务可超过 1 MiB，不等于某条记录超限。这些是序列化上界，不是浏览器吞吐实测。

最终取消保护为 `F(T)=16,384+1,024*T+512*128`，最多 212,992 字节，是 P 的子集。非取消恢复不得消耗 F 及既有最后一次操作／时间保护。取消按实际字节计费、不结算未知 allocation；物理配额、数据库打开或事务失败仍可能阻止保存取消状态。

## 派发与归属保持独立

持久 dispatch intent 仍是授权线性化点。取消不能撤回已授权在途调用，也不能证明供应商零成本；它拒绝新 intent 和迟到 artifact 接受。新 epoch、缺失调用记录或可重建 fixture 文本，都不能把 unknown 变成未发送。候选替换撤销后续可用性，但保留历史义务。新存储记账不授予任何外部能力或普通 Writer 权限。

## 验证与容量口径

冻结基线每种语言为 123 任务、60 正文章节。v1 在相同 64 MiB 上限下，中文 200,004／英文 350,007 正文 scalar 即停止，累计实际写入仅为 6,346,657／6,618,786 字节。差额是保守预留，不是无法解释的磁盘增长；历史观察不改写。

v2 必须测同一 geometry，不缩小任务图或提高上限。Node 注入原子 IO 与浏览器默认 repository／原生 IDB 分开报告，保留真实 action/IO 截止。记录已提交任务／字符、实际 fixture 调用、W/U/P、已释放量、当前保留字节、单记录／批次峰值、累计读取及冷重启成本。拒绝、超时和未完成不可改称容量通过。

回归覆盖独立实际写入字节 oracle、全部阶段前缀和转义、编码边界、未知／脱离 allocation、并发接受／取消／替换、abort／ACK 丢失、重复命令、最终取消保护、v1 只读及未知版本保留。既有 Campaign 12 场景和作者 Agent 90 场景继续保留；新增真实 IDB 记账检查不改写旧分母。

完整历史校验保持不变。reader 按至多 32 个 key 加 head 的防护批次读取每个历史 request/artifact 事件，重放全部上下文资格、账本和写入字节检查，仅保留这些事件中已验证、最终索引需要的精确引用。每个 wanted key/id/revision/hash 都必须有覆盖证明。最多保留 512 条不同 wanted 记录，序列化 key/value 载荷不超过累计 W／64 MiB；这不是 JavaScript 堆内存测量。未结请求重放表独立限 128 条，共享已验证对象，不额外保留原始字符串副本，也没有跨 read 缓存。父链由空 genesis 和逐事件版本关系证明。checkpoint/receipt 的字节计量只复用当次完整 canonical/schema/hash 校验后的真实 raw UTF-8 长度，不猜大小、不省校验。task/ref 等价比较覆盖已验证闭合结构的全部字段，保留 shape 守卫，并以旧 canonical JSON 比较为 oracle 验证了 1,185 次比较及 27 个畸形输入拒绝；最终 head/catalog/successor 防护与 commit CAS 保留。

engine 去掉两次被随后完整校验 commit 覆盖的 refresh，正常成功路径由七次完整读降为五次；不能把旧响应重新绑定新版本，也不能在冲突 intent 后派发 permit。时钟／run 检查及原截止不变。重复 IO 与冷读成本独立实测，不靠只信 head 或缩小工作量让 profile 通过。外部绕 repository 修改记录、又不更新 head 时，不承诺在该记录最后一次读取后的每个瞬间都能检测；下一次 read 必须重新加载并验证完整历史。

## 当前 Node 观察与剩余原生验收

同一冻结生产源码中，中英文各完成 1,000,000 正文 scalar／123 任务／494 笔提交。W 为 37,019,124／23,151,292 字节，U 与未结 allocation 均为零，P 均保留 524,288 字节。耗时 519,718／411,663 毫秒，最慢单步 9,177／7,227 毫秒。完整历史复验仍累计读取 10,316,863,418／6,237,533,858 字节，冷 repository 读取耗时 1,836／1,424 毫秒。这是单次 Node 观察，不是浏览器进程重启或堆内存测量。八个相同工作量前缀确认最后 CPU 修正没有改变读写计数，不作统计性能保证。

十三项 CI 保留全部既有十二项，并新增真实 IDB S01–S08 和两份完整 profile。新 job 为实测 15.52 分钟的 Node 工作留 20 分钟，浏览器初始调度留 30 分钟（约为 Node 两倍，尚非浏览器实测），安装／构建／测量／归档总上限 60 分钟；生产限制不变。原生测试核对真实故障命中、运行状态下旧 receipt 重放、完整未结义务，以及进程重启前后私有精确 checkpoint 身份。该私有身份不加入公开报告字段。

## 证据与清理

CI 只归档精确白名单内的专用闭合结构摘要及 manifest；未知字段使准备失败。完整备份、trace、store dump、生成正文和可重建请求／响应全集不上传；错误仅用有限枚举／哈希，不复制原始 stack 或 DOM。源码、构建及 probe 身份明确区分生产模块与测试观测。核心源码摘要覆盖 [campaign-build-identity.mjs](../scripts/campaign-build-identity.mjs) 中显式 `CAMPAIGN_CORE_PATHS` 清单，包含 v1 只读校验器和 v2 记账模块；应以实测修订的清单为准，而非历史文件数量，也不是完整编译器／依赖证明。本地未提交运行的 report.commit 只标识 checkout 基线，不代表修改后内容；实测源码由精确 source/harness 摘要及前后 manifest 绑定。Node 报告的 buildSha256 是这份核心源码摘要，不是编译产物哈希；浏览器报告则对测试 driver 的实际输出 assets 集合计哈希，harnessSha256 独立绑定 driver 与观测源码。repository 冷读和真实浏览器进程重启读取分别报告。浏览器 buildSha256 全零仅表示初始化未产生可测 assets 的不可用哨兵，不得视为成功构建证明。

功能代码、正式测试、验证报告及 CI 附件保留。仅在全部测试结束后清理可丢弃的临时 profile／中间材料；原始本地备份和用户文件不归入临时材料。本存储工作不声称真实模型或文学质量验收通过。
