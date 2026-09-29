# LLM-Writer 路线图

[English](ROADMAP.md) | [简体中文](ROADMAP.zh-CN.md)

以下为尚待推进的事项，顺序表示建议优先级，不代表版本发布承诺。当前实现布局见[目录结构](PROJECT_STRUCTURE.zh-CN.md)。

1. **统一剩余流式请求的生命周期。** 将其余生成入口迁移到 `useAIStream` 与独立请求作用域，优先处理 `ShortStory.vue` 的取消、重启和卸载行为，避免旧回调影响新操作。
2. **支持可编辑思维导图。** 在现有只读视图开放编辑前，先定义修改校验与小说 store 回写协议。
3. **支持按助手覆盖上下文策略。** 将预留的 `AssistantInfo.contextPolicy` 字段接入配置与运行时策略选择；目前助手使用全局策略。
4. **继续迁移视图层 TypeScript。** 按页面逐步迁移到 `lang="ts"`，迁移完成后恢复 `vue/block-lang` 规则。
5. **清零剩余 lint 警告。** 清理未使用变量，并保持现有 lint 规则有效。

后续候选事项：

- 对较长的助手消息列表采用虚拟滚动。
- 合并 store 遗留语料与 Writer 的 `corpusData`。
- 调整暗色模式下的思维导图画布底色。
