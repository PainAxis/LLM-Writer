# LLM-Writer 路线图

[English](ROADMAP.md) | [简体中文](ROADMAP.zh-CN.md)

当前实现布局见[目录结构](PROJECT_STRUCTURE.zh-CN.md)，已发布变更见[更新日志](CHANGELOG.md)。以下顺序表示建议优先级，不代表版本发布承诺。

已完成的基础工作：

- PR/main CI 执行零警告 lint、类型检查、生产构建、模块冒烟测试和使用合成 API 的真实 Chromium 回归。
- main 规则集已强制要求 GitHub Actions 的 `ci-quality`、`ci-browser` 检查通过，并要求分支与 main 保持同步。
- ShortStory 的文章、故事、续写和优化已有独立生成作用域，覆盖取消、重启、清空、关闭对话框和页面卸载。
- BookAnalysis、NovelManagement 和 ToolsLibrary 的生成请求已有独立作用域，覆盖停止、来源变更、关闭对话框和卸载，并移除了工具页的模拟进度定时器。
- undici 补丁已包含在 [v1.0.0](https://github.com/PainAxis/LLM-Writer/releases/tag/v1.0.0) 中；发布产物包含静态 ZIP、校验和及源码/CI 信息。
- 全部视图已使用 TypeScript，`vue/block-lang` 对 `src/views` 统一要求 `lang="ts"`；管理数据、表单引用和历史日期具有明确类型。四个功能的 Workspace 控制器也已完成类型迁移。
- 思维导图支持标题与条目编辑、增删和排序，校验后保留已有正文与元数据、调整关联、拒绝过期快照并等待保存完成；详见[编辑协议](docs/mindmap-editing.md)。
- 助手可跟随全局或使用独立上下文策略，配置、发送、摘要和重试统一选择策略；旧助手继续跟随全局，完整会话和备份兼容保持。详见[策略说明](docs/assistant-context-policy.md)。

- 助手消息列表使用按实际高度测量的虚拟滚动；阅读旧消息时保持位置，完整会话仍用于上下文和备份。

后续候选事项：

- 合并 store 遗留语料与 Writer 的 `corpusData`。
- 调整暗色模式下的思维导图画布底色。
