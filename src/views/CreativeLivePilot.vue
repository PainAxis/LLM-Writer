<template>
  <main class="live-pilot" data-testid="creative-live-pilot">
    <a href="#/campaigns">← Campaign Lab</a>
    <h1>真实模型三章 Pilot</h1>
    <p>中文与英文各三章，分别经过大纲、人设、细纲、三份章纲、三章正文。每项最多九次请求，共 18 次；先检查精确输入，再分别 Start。</p>
    <dl>
      <dt>模型 / 端点</dt><dd>{{ defaults.modelId }} · {{ defaults.endpoint }}</dd>
      <dt>请求配置</dt><dd>reasoning: none · standard tier · 输出上限 4,096 tokens · 无工具、无自动重试 · store: false</dd>
      <dt>项目价格复核期限</dt><dd>{{ new Date(defaults.pricingValidUntil).toISOString() }}；超过此期限需更新项目价格合同后才能授权，不代表 OpenAI 保证价格不变。</dd>
      <dt>共享费用预留</dt><dd>USD 5.743728 / 18 次，不回收已占用额度。每次按 1,050,000 输入 tokens × USD 0.30 / 百万、4,096 输出 tokens × USD 1.00 / 百万预留。按 2026-11-02 Standard Chat Completions 价格合同计算，不是账户账单硬封顶；不含税费、汇率或账户其他流量。</dd>
    </dl>
    <p>只发送本页输入的简报、随后生成的规划及已接纳前章正文给 OpenAI。Campaign 仅存在本浏览器，不进入普通 Writer 备份。结构接纳之后仍需人工检查文学质量。</p>
    <p>store: false 不等于零留存；OpenAI 滥用监测日志默认可能保留 30 天，缓存有独立留存规则。<a href="https://developers.openai.com/api/docs/guides/your-data" target="_blank" rel="noopener noreferrer">数据处理说明</a></p>
    <p>准备与读取均零调用。授权记录不保存 API key；离开或刷新即撤销本页执行权限。已发送的未知请求不能重放。</p>
    <p v-if="session.error.value" role="alert" data-testid="live-error">{{ session.error.value }}</p>
    <form v-if="!session.grant.value" @submit.prevent="prepare">
      <fieldset :disabled="session.busy.value">
        <legend>锁定中英文简报</legend>
        <label for="live-zh">中文简报</label><textarea id="live-zh" v-model="zh" data-testid="live-brief-zh" maxlength="1024" rows="4" required />
        <label for="live-en">English brief</label><textarea id="live-en" v-model="en" data-testid="live-brief-en" maxlength="1024" rows="4" required />
        <p>每种语言最多 1,024 UTF-16 units / 4,096 UTF-8 bytes，可直接在简报中写明约束。锁定后不更换简报。</p>
        <label for="live-budget">本对 Pilot 的 API 费用授权上限（USD）</label>
        <input id="live-budget" v-model="maxUsd" data-testid="live-budget" inputmode="decimal" required>
        <label><input v-model="pairConsent" data-testid="live-pair-consent" type="checkbox">我确认上述两份简报及派生规划、正文可发给所示 OpenAI 模型，并批准本对 Campaign 的费用上限。</label>
        <button data-testid="live-prepare" :disabled="!pairConsent">锁定本对 Campaign · 零调用</button>
      </fieldset>
    </form>
    <form class="restore" @submit.prevent="restore">
      <label for="live-restore-id">读取已有本地配对（任一 Campaign ID）</label>
      <input id="live-restore-id" v-model="restoreId" data-testid="live-restore-id" :disabled="session.busy.value || active" autocomplete="off">
      <button data-testid="live-restore" :disabled="session.busy.value || active || !restoreId">读取 · 不重置额度、不调用</button>
    </form>
    <template v-if="session.grant.value">
      <section data-testid="live-grant">
        <h2>本对授权记录</h2>
        <p>Grant {{ session.grant.value.grantId }} · 上限 USD {{ (session.grant.value.maxCostMicroUsd / 1_000_000).toFixed(6) }}</p>
        <p>中文：{{ session.grant.value.campaignIds.zh }}<br>English: {{ session.grant.value.campaignIds.en }}</p>
        <p>每项准备后有 15 分钟执行窗口；刷新、恢复、重新输入 key 均不延长期限。</p>
        <form v-if="!session.prepared.value.zh || !session.prepared.value.en" @submit.prevent="complete">
          <p>本对准备尚未齐全。原有项保持不变；补全项使用同一 ID、同一简报哈希和同一额度。</p>
          <template v-for="language in languages" :key="language">
            <label v-if="!session.prepared.value[language]">{{ language }} 原始简报（必须与已授权哈希完全一致）
              <textarea v-model="missing[language]" :data-testid="`live-missing-${language}`" rows="4" />
            </label>
          </template>
          <button data-testid="live-complete" :disabled="session.busy.value">补全原配对 · 零调用</button>
        </form>
        <form @submit.prevent="authorize">
          <label for="live-key">OpenAI API key · 仅本页内存</label>
          <input id="live-key" ref="keyInput" data-testid="live-key" type="password" autocomplete="off" spellcheck="false" :disabled="session.busy.value" @input="credentialChanged">
          <label><input v-model="sessionConsent" data-testid="live-session-consent" @change="sessionConsent || revoke()" type="checkbox" :disabled="session.busy.value || active">我授权本次页面会话在原有配对和额度内发送请求。</label>
          <button data-testid="live-authorize" :disabled="session.busy.value || active || !sessionConsent || !session.prepared.value.zh || !session.prepared.value.en">启用本页模型连接 · 尚不调用</button>
          <button type="button" data-testid="live-revoke" :disabled="!session.authorized.value" @click="revoke">停止并清除本页 key</button>
        </form>
        <p data-testid="live-authority">{{ session.authorized.value ? '会话连接已启用；下方分别预览并 Start。' : '未启用模型连接；读取与本地核验可用。' }}</p>
      </section>
      <template v-for="language in languages" :key="`${session.generation.value}-${language}`">
        <CreativePilotPanel v-if="session.engines.value[language] && session.prepared.value[language]" :campaign-id="session.grant.value.campaignIds[language]" :selected-v4="true"
          :engine="session.engines.value[language]" :locked-brief="true" :external-busy="session.busy.value || otherBusy(language)" @busy="running[language] = $event" />
      </template>
    </template>
  </main>
</template>

<script setup lang="ts">
import { computed, onUnmounted, reactive, ref } from 'vue'
import CreativePilotPanel from '@/components/CreativePilotPanel.vue'
import { useCreativeLivePilot } from '@/composables/useCreativeLivePilot'
import { CREATIVE_LIVE_GRANT_DEFAULTS } from '@/services/writerCampaign/creativePilotProtocol'
import type { CreativeLanguage } from '@/types/creativePilot'
const defaults = CREATIVE_LIVE_GRANT_DEFAULTS, languages = ['zh', 'en'] as const
const session = useCreativeLivePilot()
const zh = ref(''), en = ref(''), maxUsd = ref('6'), pairConsent = ref(false), sessionConsent = ref(false), restoreId = ref('')
const keyInput = ref<HTMLInputElement | null>(null)
const missing = reactive({ zh: '', en: '' })
const running = reactive({ zh: false, en: false }), active = computed(() => running.zh || running.en)
const otherBusy = (language: CreativeLanguage) => language === 'zh' ? running.en : running.zh
async function prepare() {
  await session.prepare({ zh: { protocol: 'creative-brief-v1', language: 'zh', premise: zh.value, constraints: [] },
    en: { protocol: 'creative-brief-v1', language: 'en', premise: en.value, constraints: [] }, maxUsd: maxUsd.value, consent: pairConsent.value })
}
async function complete() {
  const input: Partial<Record<CreativeLanguage, { protocol: 'creative-brief-v1'; language: CreativeLanguage; premise: string; constraints: string[] }>> = {}
  for (const language of languages) if (!session.prepared.value[language] && missing[language]) input[language] = { protocol: 'creative-brief-v1', language, premise: missing[language], constraints: [] }
  await session.complete(input)
}
async function restore() { clearInput(); sessionConsent.value = false; await session.restore(restoreId.value) }
function clearInput() { if (keyInput.value) keyInput.value.value = '' }
function credentialChanged() { if (session.authorized.value) { session.revoke(); sessionConsent.value = false } }
async function authorize() { const key = keyInput.value?.value ?? ''; clearInput(); await session.authorize(key, sessionConsent.value) }
function revoke() { session.revoke(); clearInput(); sessionConsent.value = false }
onUnmounted(() => { session.dispose(); clearInput() })
</script>

<style scoped>
.live-pilot { max-width: 1100px; margin: 0 auto; padding: 24px; line-height: 1.6; }
fieldset, section, .restore { border: 1px solid #bbc8d4; border-radius: 8px; padding: 16px; margin: 20px 0; }
label { display: block; margin: 12px 0 6px; }
textarea { width: 100%; box-sizing: border-box; font: inherit; }
input, button { font: inherit; padding: 8px; } input[type="checkbox"] { margin-right: 8px; }
button { margin: 12px 12px 0 0; } button:disabled { opacity: .5; }
dt { font-weight: 600; } dd { margin: 0 0 10px; overflow-wrap: anywhere; }
[role="alert"] { color: #9b2323; }
</style>
