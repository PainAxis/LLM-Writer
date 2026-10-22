<template>
  <section class="support-check" :data-testid="`${prefix}-support`" :data-state="state.phase" aria-label="可选语义支持检查">
    <label class="toggle"><input type="checkbox" :checked="state.enabled" :disabled="disabled && !state.enabled" :data-testid="`${prefix}-support-enabled`" @change="state.setEnabled(($event.target as HTMLInputElement).checked)" />可选：检查所选原文能否支持回答（默认关闭）</label>
    <p class="muted">这是模型对所选原文的判断，不是真实性保证。不自动选择、批准依据，也不会写入正文、生成提示词或备份。</p>
    <template v-if="state.enabled">
      <label class="question-field"><span>本次检查的问题（默认使用检索内容，可单独修改）</span><textarea :value="state.question" :disabled="disabled" rows="2" :data-testid="`${prefix}-support-check-question`" @input="state.setQuestion(($event.target as HTMLTextAreaElement).value)" /></label>
      <p class="muted">使用当前配置的聊天模型，无需新密钥。问题最多 500 字符，每段原文最多 2,000 字符。先准备本地预览，不发送数据；核对问题、完整引用和目的地后，再明确发送。可能产生费用。</p>
      <p v-if="!available" class="warning" :data-testid="`${prefix}-support-unavailable`">请完成检索，再明确勾选需要检查的完整原文依据。未完成或暂停中的扫描结果不能用于检查。</p>
      <div class="actions">
        <button :disabled="disabled || !available || !state.question.trim() || active" :data-testid="`${prefix}-support-prepare`" @click="state.prepare()">{{ state.phase === 'preparing' ? '正在本地校验…' : '准备发送预览（不联网）' }}</button>
        <button v-if="state.phase === 'preparing' || state.phase === 'ready' || state.phase === 'running'" :data-testid="`${prefix}-support-cancel`" @click="state.cancel()">取消检查并清除预览</button>
        <button :data-testid="`${prefix}-support-close`" @click="state.setEnabled(false)">关闭并清除检查</button>
      </div>
      <section v-if="state.preview" class="preview" :data-testid="`${prefix}-support-preview`" aria-label="本次发送预览">
        <h4>本次将发送</h4>
        <p class="question" :data-testid="`${prefix}-support-question`">{{ state.preview.question }}</p>
        <p :data-testid="`${prefix}-support-destination`">{{ state.preview.providerLabel }} · 模型 {{ state.preview.modelId }} · 目的地 {{ state.preview.endpointLabel }}</p>
        <p class="muted">只发送上方问题及下列原文，不发送章节标题、项目名称、作者标注或关系描述。目的地如使用代理会一并列出；URL 用户信息、查询参数及密钥不显示。</p>
        <p :data-testid="`${prefix}-support-budget`">本次 {{ state.preview.sourceCount }} 段，原文 {{ state.preview.sourceChars }} 字符。最多 8 段、8,000 原文字符；仅一次调用尝试，不自动重试；输出最多 1,200 tokens、响应最多 64 KiB，总时限 45 秒。预览 5 分钟后失效。完整输入 {{ state.preview.inputChars }} 字符 / {{ state.preview.inputBytes }} 字节，上限 16,000 字符 / 48,000 字节。数量与篇幅不代表可信度。</p>
        <article v-for="(source, index) in state.preview.sources" :key="`${source.chapterId}:${source.start}:${source.end}`" class="citation" :data-testid="`${prefix}-support-source-${index}`">
          <p>引用 {{ index + 1 }} · 第 {{ source.ordinal }} 章 · {{ source.chapterTitle }} · {{ source.start }}–{{ source.end }}</p>
          <p class="revision">章节版本 {{ source.sourceRevision }}</p>
          <blockquote>{{ source.quote }}</blockquote>
        </article>
        <button v-if="state.phase === 'ready'" :disabled="disabled || !available" :data-testid="`${prefix}-support-send`" @click="state.run()">确认发送问题与所选原文，开始一次检查</button>
      </section>
      <p v-if="state.phase === 'running'" role="status" :data-testid="`${prefix}-support-running`">正在检查，不展示未校验的流式答案。此时不能批准写作依据。</p>
      <section v-else-if="state.result.state === 'assessed'" class="assessment" :data-testid="`${prefix}-support-assessment`" :data-verdict="state.result.verdict" role="status">
        <h4>{{ verdictText[state.result.verdict] }}</h4>
        <p class="warning">引用位置已核对，语义仍须作者复核。仅针对所选原文，不证明全书有或没有答案；这不是“已验证答案”。</p>
        <p v-if="state.result.answer" :data-testid="`${prefix}-support-answer`">{{ state.result.answer }}</p>
        <p :data-testid="`${prefix}-support-explanation`">{{ state.result.explanation }}</p>
        <article v-for="(premise, index) in state.result.premises" :key="index" class="premise" :data-testid="`${prefix}-support-premise-${index}`">
          <h5>{{ state.result.verdict === 'insufficient' ? '部分依据' : '依据前提' }} {{ index + 1 }}</h5>
          <p>{{ premise.text }}</p>
          <div v-for="(citation, citationIndex) in premise.citations" :key="`${citation.chapterId}:${citation.start}:${citationIndex}`" class="citation">
            <p>第 {{ citation.ordinal }} 章 · {{ citation.chapterTitle }} · {{ citation.start }}–{{ citation.end }}</p>
            <p class="revision">章节版本 {{ citation.sourceRevision }}</p>
            <blockquote :data-testid="`${prefix}-support-citation`">{{ citation.quote }}</blockquote>
          </div>
        </article>
        <div v-if="state.result.missing.length" :data-testid="`${prefix}-support-missing`"><h5>仍缺少或未解决的前提</h5><ul><li v-for="(missing, index) in state.result.missing" :key="index">{{ missing }}</li></ul></div>
        <p class="muted">本次检查不等于批准。用于写作前，仍须明确核对所选依据。</p>
      </section>
      <p v-else-if="state.phase !== 'preparing' && state.phase !== 'ready'" :data-testid="`${prefix}-support-unverified`" role="status">尚未进行有效的语义支持检查。{{ reasonText[state.result.reason] }}</p>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { MemorySupportUiState, SupportUiReason } from '@/composables/useMemorySupportCheck'
const props = withDefaults(defineProps<{ state: MemorySupportUiState; available: boolean; disabled?: boolean; prefix?: string }>(), { prefix: 'memory' })
const active = computed(() => props.state.phase === 'preparing' || props.state.phase === 'running')
const verdictText = {
  supported: '模型判断：所选原文可支持此回答',
  insufficient: '模型判断：所选原文依据不足；不代表全书没有答案',
  uncertain: '模型判断：所选原文存在不确定性',
}
const reasonText: Record<SupportUiReason, string> = {
  disabled: '检查未开启。', not_run: '尚未运行。', unavailable: '当前无法准备检查，请核对所选依据后重试。',
  source_changed: '引用来源已改变或未通过校验，请重新检索。', stale: '来源、选择或设置已改变，旧检查已清除。',
  cancelled: '检查已取消。', timeout: '检查已超时，不会自动重试。', invalid_response: '模型返回内容未通过格式与引用校验。',
  transport: '服务调用失败，不会自动重试。', settings: '当前聊天模型设置不可用于此检查，请先检查设置。',
  input_budget: '超出检查预算；不会截断原文。请减少完整依据后重新准备。',
  invalid_input: '问题或完整依据不符合检查要求。', owner_changed: '当前检查已失效，请重新准备。',
  configuration_changed: '聊天模型设置已改变，旧检查已清除。', expired: '预览已过期，请重新准备。',
  response_too_large: '响应超出上限，未展示任何模型结论。', output_incomplete: '模型响应不完整，未展示任何结论。',
  request_limit: '本次调用尝试已用完，不会自动重试。',
}
</script>

<style scoped>
.support-check { margin: 16px 0; padding: 14px; border: 1px solid var(--el-border-color); border-radius: 8px; font-size: 13px; color: var(--el-text-color-primary); overflow-wrap: anywhere; }
p, li { line-height: 1.7; } h4, h5 { margin: 10px 0; } .toggle { display: flex; gap: 8px; align-items: flex-start; line-height: 1.7; }.toggle input { flex: 0 0 18px; width: 18px; height: 18px; margin-top: 3px; }
.question-field { display: grid; gap: 8px; margin: 12px 0; }.question-field textarea { box-sizing: border-box; width: 100%; padding: 8px; border: 1px solid var(--el-border-color); border-radius: 6px; font: inherit; color: inherit; background: var(--el-fill-color-blank); resize: vertical; }
.actions { display: flex; flex-wrap: wrap; gap: 10px; }.muted, .revision { color: var(--el-text-color-secondary); }.revision { font-size: 12px; }.warning { color: var(--el-color-warning-dark-2); }.preview, .assessment { margin-top: 14px; padding-top: 10px; border-top: 1px solid var(--el-border-color); }.citation, .premise { margin: 12px 0; }.question, blockquote { white-space: pre-wrap; } blockquote { margin: 8px 0; padding: 10px 12px; background: var(--el-fill-color-light); border-left: 3px solid var(--el-color-info); line-height: 1.8; }
button { padding: 9px 12px; border: 1px solid var(--el-border-color); border-radius: 6px; font: inherit; color: inherit; background: var(--el-fill-color-blank); cursor: pointer; white-space: normal; } button:disabled { opacity: 0.6; cursor: not-allowed; } button:focus-visible, input:focus-visible, textarea:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: 2px; }
@media (max-width: 480px) { button, .toggle { min-height: 44px; } .support-check { padding: 10px; } }
</style>
