# Campaign 持久化基础

[English](writer-campaign-foundation.md) | [简体中文](writer-campaign-foundation.zh-CN.md)

实现状态：**本地 lint、构建、111组 smoke 与严格脚本类型检查已通过；准确 head CI（含真实 IndexedDB 浏览器检查）待验收**。本项是可复用的 production 状态、存储、预算基础及离线 QA 界面，不是自主小说生成。[第四阶段最终合同](writer-agent-longform-acceptance.zh-CN.md) 仍要求中文、英文各一部，各 1,000,000 正文字符，从大纲、人设、细纲、章纲到正文，并完成独立全作一致性审查。脚本任务队列或大容量存储 fixture 都不满足该最终标准。

## 范围与入口

独立 Campaign Lab 预期位于 `/#/campaigns`。它创建固定的短中文或英文合成 campaign，每次显式操作只执行一个任务，并支持检查、暂停、恢复及取消。打开或刷新页面不自动派发。恢复是状态和归属操作，不是重放未知请求的许可。

引擎处理真实任务类型 `outline`、`character_bible`、`detailed_outline`、`chapter_outline`、`chapter_body`，具有显式依赖和精确 artifact 修订。provider port、派发授权边界与 fixture adapter 相互独立。本轮只注册离线 adapter，不包含真实 endpoint、模型发现、已存 API 配置、凭据读取或付费调用。

任务完成、实际正文字符进度和最终文学验收分别报告。短 fixture 可以执行完声明的任务，却远未达到百万字符目标；这不代表小说完成。语义质量及长篇最终验收保持 **NOT RUN**。

既有手动 Writer Agent 不变：不自动批准依据，不新增追加许可，不放松普通保存归属。Campaign 操作不写入小说、事实图谱或 API 设置。

## 持久身份与原子提交

Campaign 在既有 IndexedDB key/value store 中使用独立、稳定的 namespace，复用已提交读取和多键 CAS。不引入第二个文件数据库、后台常驻进程或外部服务。

版本化 manifest 保存 campaign/candidate 身份、语言、正文字符目标、有序任务依赖、adapter/fixture 身份、实现身份及有限预算。持久 manifest 是数据，不是网络能力。不可变 artifact 保留精确原文、修订与哈希；原始和规范化后的 Unicode scalar、UTF-16、UTF-8 计数分开，规划文字不计入正文进度。

每次 mutation 比较实际持久 head，包括 epoch。内存归属检查只是补充，不是跨标签页排他。checkpoint、artifact、receipt 的不可变 key 仅能创建，除非已核实为精确幂等重用。同 operation ID 及绑定业务 payload 返回原 receipt，不再写入；同 ID 异 payload 拒绝。

artifact 接纳、任务可执行性、累计预算、checkpoint 和 receipt 同时提交。哈希与序列化在 IDB transaction 前完成；事务内不发送网络请求，不 await 回调。成功 transaction receipt 证明实际提交。acknowledgement 延迟或失败不证明没有保存。

未知 schema、损坏 JSON、缺失引用 artifact、哈希冲突及过时修订均保留并拒绝，不重置为空 campaign。首切使用有界任务索引和不可变链，不引入 Merkle/分页框架。实际容量与配置上限分开测量。

## 派发、取消与不确定结果

每次派发先取得持久预留，再提交持久 `dispatch_intent`。intent 是授权线性化点。只有赢得该迁移的执行者能调用 adapter，至多一次。持久 JSON 或继承的手动 Writer grant 都不能制造运行时能力。

intent 之后的跨标签页取消可能与已经获准的调用竞争。因此取消**不承诺之后零调用或零费用**，只阻止新 intent，并拒绝将旧结果接纳为 artifact。abort 只能尽力；取消不能撤销此前已提交的 artifact。UI 必须区分本实例停止与持久取消，对不确定的持久结果如实显示。

| 已有持久证据 | 安全操作 |
|---|---|
| 已有 reservation，但 winning fence/coherent check 后确认无 intent | 用新鲜授权继续同一有限 attempt，或停止；不重置账本 |
| 已有 intent，却无可信 completion/result | 保持 unknown，保留预留，不重放 |
| 精确 result 已持久保留，但 artifact 尚未接纳 | 校验后仅重试保存，不再调用 adapter |
| 已有匹配 operation receipt | 报告实际提交，即使 ack 丢失或 head 后来继续前进 |
| 无 receipt 且 head 仍旧 | 不推断失败；先 fence 旧提交者并重新读取，才可能 save-only recovery |
| 证据损坏/不匹配或读取失败 | 保持 blocked/unknown，保留现场 |

commit fence 不是外部派发 fence。没有调用记录、换了 epoch，或能生成相同 fixture 文字，都不能证明获准请求未发送。首版 reconciliation 只接受已经存在、绑定原 request/input 的可信完成证据；不存在就保持 unknown。晚到的有界 usage 证据不能退还未知预留、复活取消的 campaign 或追加章节。

## 修订与资源边界

candidate/artifact replacement 产生新的不可变修订，并原子失效依赖任务的可执行性、正文计数与索引状态。旧 in-flight 结果不能挂到新 candidate。更换 candidate 不清空 campaign 预算。本基础不实现自动语义修复或 canon 发展。

有限累计预留跨重启、失败和未知请求保留。reserved ceiling、observed usage 和不可用计量分开；未知 provider 费用不是零。请求 attempt、序列化输入/输出、活动时间/deadline、metadata/artifact 存储均有界。取消、reconciliation、save-only recovery 也需要有限安全余量；重复相同命令不能无限消耗终态余量。

序列化载荷计量不是浏览器物理磁盘保证。同 origin 其他数据、IDB 配额、open/transaction 失败、清理浏览器数据都可能发生。活动时间预留/deadline 不能因进程重启或时钟回拨重置。声明容量前必须沿 production 路径测量 metadata 增长、读取批量和 resume 延迟。浏览器规范化/计数不替代最终验收要求的独立固定计数核验。

## 本地数据与备份限制

Campaign artifact/checkpoint 仅在当前浏览器 profile 本地保存。**本轮普通 Writer 备份/恢复不包含、不恢复 Campaign 数据。** 反向也要求恢复普通小说不能改变 Campaign key。目前没有 Campaign 云同步、完整导出/恢复 UI 或自动保留期清理。清除浏览器数据可能丢失这些记录。

完整 artifact、导出、备份、trace、可重建全文的请求/响应集合不可上传。CI 只可发布专用 closed-schema、无正文的派生 summary 及其 manifest，不递归复制未知字段。完整故障/来源材料留本地，CI stderr 不应打印。小型固定合成 fixture 源码属于普通测试代码，不是完整生成小说或备份。

## 必要验证与剩余工作

验收前须完成确定性的 production engine/repository 测试，以及真实 built-app IndexedDB 重启、双标签 CAS、取消、未知 request/commit、ack 丢失测试。核验不可变记录 create-only、精确 operation replay、预算边界、candidate 失效、损坏/未来版本及旧备份隔离。大容量中英文存储 profile 只验证持久化/资源行为，不验证文学质量。所有既有 Writer/普通保存回归及准确 head 的必要 CI 仍必须通过。

实现冻结并审阅后，本文会补充实测限制与准确证据。当前不宣称真实模型、自主小说、全作语义审计或第四阶段最终成功。后续仍需版本化 canon/context assembly、显式授权的真实 provider 派发与校准、真正的规划/章节编排、独立全作审计与有界修复，最后才是获准的两部重型验收。

## 构建身份、实测与复现口径

核心身份绑定八个具名 production 源文件（含 IDB 原语）的 SHA-256。干净构建记录真实 Git commit/tree；有未提交变化或源码归档时两者为 null，不把旧父提交假称为当前实现。该身份不证明编译器、依赖和浏览器环境一致。身份变更后仍可查看旧 Campaign，但没有未来明确迁移就不能继续修改／续跑。故障构建另记 probe hash 和 buildMode。读取会校验目录；若旧 head 的后继不可变检查点已存在，则拒绝该回滚，原数据不重写。历史读取每批最多32条记录加 head。

目录最多保留32个 Campaign；当前没有删除／导出界面，不应为了创建新 Campaign 清除含其他 Writer 数据的浏览器存储。单 Campaign 默认上限为128个任务／请求尝试、256个产物、2,048次持久操作、64 MiB累计序列化载荷／存储预留及七天截止。单请求输入和响应各最多64 KiB；每次活动操作受10秒单调时钟限制，续接重新预留活动额度，不复用已耗时间。恢复池保留有限16次操作／160秒及512 KiB。配置上限不等于已测成功容量；预留按最坏 JSON 转义保守估计，未知请求不退款。

中英文百万目标存储几何 profile 报告实际停止位置，包括触限拒绝；重复几何文本不是小说或质量证据。真实浏览器为固定12例：C01–C03使用普通 production build，C04–C12使用独立标明的离线 host 观察／故障构建，仍走真实 engine、CAS、IndexedDB，transform 不替换状态、预算或持久化逻辑。未插桩场景的精确 adapter 进入次数记 null，不以 UI 指示器推算。工程工作区未运行本地浏览器。

- `npm run smoke:writer-campaign-store`、`smoke:writer-campaign-engine`、`smoke:writer-campaign-ui`、`smoke:writer-campaign-evidence` 全部进入 `npm run smoke:all`。
- `npm run test:browser-writer-campaign` 是现有 `ci-writer-agent` job 的独立有时限步骤，不暗中加入旧 browser 总 runner。原十二项必要 CI 保持。
- Campaign 上传只含闭合 schema 派生的 `report.summary.json` 与 manifest。未知字段使准备失败，不上传截图或 raw report 目录。

## 实测容量限制（不是百万容量通过）

`npm run profile:writer-campaign-capacity` 在 Node 注入原子 IO 上执行 production engine/repository，生成123任务、60章、每部1,000,000字符目标的中英重复文本几何，仅内存保存完整数据。中文在200,004正文字符／28个任务及调用处触限，实际存活6,309,217 bytes、累计写入6,346,657 bytes、累计预留66,456,411 bytes；英文在350,007字符／46任务及调用处触限，分别为6,557,604／6,618,786／65,625,495 bytes。两者上限67,108,864 bytes，均为 budget_exhausted，最终长篇验收 NOT_RUN。

冷校验恢复分别173.89／236.81 ms，读取6,363,172／6,636,348 bytes；这些是本次 Node 单次观察，不是浏览器性能承诺。最大批次33 keys，中文1,205,520 bytes、英文728,686 bytes。另一个独立 repository 小测覆盖64 KiB artifact、127任务和41检查点。

预留与累计实际写入的差额约60.11／59.01 MB，主要是永久最坏转义／未来写入上界，不是实际存储泄漏或物理磁盘耗尽。当前存活与累计写入的差额37,440／61,182 bytes来自被替换 head 的历史写入计量。百万容量尚未通过。紧接的聚焦修正需区分累计实际写入与仍未解除的后续写入义务，绑定 allocation/settlement 身份；已知输入可用精确 JSON 字节估计，未知请求义务不得消失。结算须补崩溃、ACK丢失、并发和修订失效反例，不以提高 cap 或直接退款替代证明。

上述 Node profile 全程累计读取中文570,635,858 bytes／10,577批，英文997,803,343 bytes／26,957批。单批有界不代表反复历史校验的总工作量为线性；后续容量调查也必须测量这种放大，而非只修预算数字。未宣称浏览器长篇吞吐已达标。

[精简验证记录](testing/writer-campaign-foundation-2026-10-24/REPORT.md)绑定本地检查与不含正文的容量观察，严格区分本地浏览器 NOT RUN 和随后准确 head 的 CI 结果。
