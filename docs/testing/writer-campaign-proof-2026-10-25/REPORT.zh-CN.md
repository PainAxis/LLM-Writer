# Campaign action 私有校验证明：本地证据

[English](REPORT.md) | [简体中文](REPORT.zh-CN.md)

状态：零 warning lint、严格 TypeScript、build 及 **128 套 smoke 全通过**。同一 clean 源码中英文结构 profile 各串行重复两次均通过。真实原生 IndexedDB、精确 head 的全部 13 项 CI 及合并后 main 跟进仍**待验收**。自主文学验收 **NOT RUN**。

## 失败基线及修正边界

保留的 [main 失败](BASELINE-MAIN.json) 来自 [run 40170296500](https://github.com/PainAxis/LLM-Writer/actions/runs/40170296500)，提交 `d098d27ba53a2edebbd1d7ec8dd49166cd81ec8f`。Node 中文停在 966,686 scalar、120 任务、121 调用、486 提交，保留 U = 1,927,388 B。commit 阶段观察到 action 所选计时到期，当时仅约剩 1,981 ms；不能由此断言单次 commit CPU 是累计耗尽的全部原因。原生通过未替代 Node 失败。

[双语合同](../../writer-campaign-action-proof.zh-CN.md) 明确：普通 action 一次完整冷语义重放，后续 CAS 前仍完整逐字复读所有历史 raw。历史字节、新鲜边界、新转移、请求身份、保守未知义务及独立冷恢复均继续验证。不改持久 schema、存储记账、blobStore、workflow 限制及上传白名单。替换重放查询共享 Run 截止，是明确的执行约束收紧，不冒称纯性能等价。

## 本地精确身份

实测提交 `a0693312a1a1393bbf9ab10c3eb35f1ed60ea681`，tree `aa965db583a53bc132dd7df9e9202e9ebadf2e9e`。

核心 SHA-256：`69a1fd9ccd03b35b3f377a513764496d9064825b3f432c08cc7fbe56e23d7258`。
Harness SHA-256：`0c70645911f72bbe034bdff93aaac21ad35b345cf8a6351eb36edc9e4706c681`。

474 个原生路径在全回归和两轮双语测量前后逐字一致；后续文档／证据追加不改变它们。[LOCAL-VALIDATION.json](LOCAL-VALIDATION.json) 保留变更源码 hash 和 13 份本地原始证据的字节数／hash，不把完整日志复制入库。

独立定向复跑通过仓库 proof 217、engine 生命周期 49、operation timing 11、既有 timeout 15、store、engine 44 和 read-batches 21。随后仅测试新增两条迟到 rejection，timing 变为 13 并包含在全量 128 套通过中。另一独立只读审阅覆盖闭合投影、原生故障／重启编排和证据隐私边界；这些不等于真实浏览器或 CI 通过。

## 同源观察

四份运行均提交 **1,000,000 正文 scalar / 123 任务 / 123 fixture 调用 / 494 事务**，记账差异、未结 allocation 和 U 均为零；超时诊断及完整 operation 结果计数的 timeout/error/abort 均为零。正文为固定重复字符，仅用于结构容量，不是小说。

| 轮次／语言 | 执行 ms | action p50 / p95 / max ms | 完整 operation max ms | 堆采样峰值 B |
|---|---:|---:|---:|---:|
| 1 / zh | 121,919 | 915 / 2,050 / 2,220 | 1,764.455 | 214,311,544 |
| 1 / en | 97,064 | 749 / 1,646 / 1,763 | 1,483.445 | 332,814,384 |
| 2 / zh | 124,878 | 913 / 2,063 / 2,365 | 1,901.204 | 238,476,784 |
| 2 / en | 102,732 | 784 / 1,684 / 1,810 | 1,518.975 | 199,013,688 |

两轮中最小观测 action 余量为 7,635 ms，相对 10,000 ms；最小 operation 余量为 1,098.796 ms，相对适用的 3,000 ms IO 限制，dispatch 仍为 5,000 ms。这是本机观察到的实质余量，不是任意硬件保证或原生浏览器结论，也不是新旧配对性能实验。

每语言每轮均为 123 次完整冷重放、493 次 exact 复读、394,833 条匹配历史记录，无 fallback；关闭后保留字节／条目／活动记录均为零。私有 raw 峰值中文 36,856,297 B、英文 22,988,465 B，最多 1,604 条目、246 活动记录；低于固定 64 MiB 序列化上限，**不等于 heap 上限**。

冷重放总时长中文 97,281.681–99,858.511 ms、英文 80,650.180–85,126.808 ms；exact 复读总时长分别 18,111.404–18,394.973 / 11,280.711–12,074.261 ms。它们不包含完整 commit 的所有工作，不能代替 operation 最大耗时。独立最终冷 repository 读取分别 1,790/1,875 ms、1,499/1,531 ms，各 67 次 IO。

heap 采样峰值受进程复用及未强制 GC 影响，英文在同进程中文之后运行；不代表 proof 独占分配、真实峰值、RSS 或 GC pause。没有 heap dump 或强制 GC，也不声称相对旧版内存改善。

## 剩余成本及门槛

两轮账本及非计时工作量／proof 计数相同。中英文累计写入仍为 37,019,200 / 23,151,368 B；Node repository 累计读 **10,300,596,021 / 6,221,189,212 B**，19,545 / 19,308 次。全部历史仍复读，和旧 verifier 的少量读取计数差异不是次线性 IO 优化；原生 CAS/读取是不同计量边界。既有分批历史观察→CAS 的非原子窗口不变，不保证原子全历史快照。

[精简观察](NODE-OBSERVATION.json) 保留准确计数、heap 采样、action 分位数及逐 phase min/max/结果；完整固定分桶直方图在已 hash 的闭合本地报告中。旧证据仅标未采集，不能补造数据；新 clean gate 要求实际采集且零 timeout/error/abort，拒绝未知字段、正文及请求全集。

合并前仍须原生 S01–S08 加 P01–P06、双语百万 scalar profile 和真实进程冷重启、精确 head 的全部 13 项 CI、附件白名单核验、独立审阅及 main 跟进，不能拼旧 head 的通过记录。完整备份／生成包只留本地，正式报告及 CI 附件保留，临时材料在测试结束后清理。真实模型写作质量及中英文各百万字符自主小说仍为 **NOT RUN**。
