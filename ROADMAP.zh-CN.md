# LLM-Writer 路线图

[English](ROADMAP.md) | [简体中文](ROADMAP.zh-CN.md)

当前实现布局见[目录结构](PROJECT_STRUCTURE.zh-CN.md)，已发布变更见[更新日志](CHANGELOG.md)。以下顺序表示建议优先级，不代表版本发布承诺。

已完成的基础工作：

- PR/main CI 执行零警告 lint、类型检查、生产构建、模块冒烟测试和使用合成 API 的真实 Chromium 回归。
- ShortStory 的文章、故事、续写和优化已有独立生成作用域，覆盖取消、重启、清空、关闭对话框和页面卸载。
- undici 补丁已包含在 [v1.0.0](https://github.com/PainAxis/LLM-Writer/releases/tag/v1.0.0) 中；发布产物包含静态 ZIP、校验和及源码/CI 信息。
- ShortStory、BookAnalysis、NovelManagement、ToolsLibrary 已完成首轮拆分，提取了带类型的提示词、配置、导入、列表逻辑及 UI 组件；父页面脚本尚未全部迁移到 TypeScript。

下一步：

1. **将 CI 设置为 main 合并的必要条件。** 在 main 规则集中加入已有的 `ci-quality`、`ci-browser` 检查；工作流自动执行本身不等于强制合并门槛。
2. **统一剩余生成请求的生命周期。** 将 BookAnalysis 的分析/摘要、NovelManagement 的简介生成和 ToolsLibrary 的生成流程迁入独立控制器，覆盖来源变更、关闭对话框、卸载、迟到结果和进度计时器清理。
3. **继续迁移视图层 TypeScript。** 先将剩余编排逻辑迁入带类型的控制器，再按 ShortStory → BookAnalysis → NovelManagement → ToolsLibrary 的顺序迁移父页面到 `lang="ts"`，视图迁移完成后恢复 `vue/block-lang` 规则。
4. **支持可编辑思维导图。** 在现有只读视图开放编辑前，先定义修改校验与小说 store 回写协议。
5. **支持按助手覆盖上下文策略。** 将预留的 `AssistantInfo.contextPolicy` 字段接入配置与运行时策略选择；目前助手使用全局策略。

后续候选事项：

- 对较长的助手消息列表采用虚拟滚动。
- 合并 store 遗留语料与 Writer 的 `corpusData`。
- 调整暗色模式下的思维导图画布底色。
