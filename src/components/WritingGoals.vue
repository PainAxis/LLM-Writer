<template>
  <div class="writing-goals">
    <div class="goals-header">
      <h3>🎯 写作目标</h3>
      <el-button type="primary" size="small" @click="openAddGoal">
        <el-icon><Plus /></el-icon>
        新增目标
      </el-button>
    </div>

    <!-- 目标统计概览 -->
    <div class="goals-overview">
      <el-row :gutter="16">
        <el-col :span="6">
          <div class="overview-card">
            <div class="card-icon daily">
              <el-icon><Calendar /></el-icon>
            </div>
            <div class="card-content">
              <div class="card-title">今日目标</div>
              <div class="card-value">{{ todayProgress.current }}/{{ todayProgress.target }}</div>
              <div class="card-subtitle">{{ todayProgress.unit }}</div>
            </div>
          </div>
        </el-col>
        <el-col :span="6">
          <div class="overview-card">
            <div class="card-icon weekly">
              <el-icon><Clock /></el-icon>
            </div>
            <div class="card-content">
              <div class="card-title">本周目标</div>
              <div class="card-value">{{ weeklyProgress.current }}/{{ weeklyProgress.target }}</div>
              <div class="card-subtitle">{{ weeklyProgress.unit }}</div>
            </div>
          </div>
        </el-col>
        <el-col :span="6">
          <div class="overview-card">
            <div class="card-icon monthly">
              <el-icon><TrendCharts /></el-icon>
            </div>
            <div class="card-content">
              <div class="card-title">本月目标</div>
              <div class="card-value">{{ monthlyProgress.current }}/{{ monthlyProgress.target }}</div>
              <div class="card-subtitle">{{ monthlyProgress.unit }}</div>
            </div>
          </div>
        </el-col>
        <el-col :span="6">
          <div class="overview-card">
            <div class="card-icon streak">
              <el-icon><Trophy /></el-icon>
            </div>
            <div class="card-content">
              <div class="card-title">连续天数</div>
              <div class="card-value">{{ currentStreak }}</div>
              <div class="card-subtitle">天</div>
            </div>
          </div>
        </el-col>
      </el-row>
    </div>

    <!-- 活跃目标列表 -->
    <div class="active-goals">
      <div class="active-goals-header">
        <h4>📋 活跃目标</h4>
        <div class="goals-controls">
          <el-button 
            type="text" 
            size="small" 
            @click="toggleSortMode"
            :class="{ 'sort-active': sortMode }"
          >
            <el-icon><Rank /></el-icon>
            {{ sortMode ? '完成排序' : '调整排序' }}
          </el-button>
        </div>
      </div>
      
      <div v-if="activeGoals.length === 0" class="empty-state">
        <el-empty description="暂无活跃目标，创建一个开始吧！" />
      </div>
      <div v-else class="goals-list">
        <div v-if="sortMode" class="sort-tip">
          <el-alert
            title="拖拽目标卡片可以调整在首页的显示顺序"
            type="info"
            :closable="false"
            show-icon
          />
        </div>
        
        <transition-group 
          name="list" 
          tag="div" 
          class="sortable-goals"
        >
          <div 
            v-for="(goal, index) in activeGoals" 
            :key="goal.id" 
            class="goal-item"
            :class="{ 'sortable': sortMode }"
            :draggable="sortMode"
            @dragstart="onDragStart($event, index)"
            @dragover="onDragOver"
            @drop="onDrop($event, index)"
          >
            <div class="goal-header">
              <div class="goal-info">
                <span class="goal-title">{{ goal.title }}</span>
                <el-tag :type="getGoalTypeColor(goal.type)" size="small">{{ getGoalTypeText(goal.type) }}</el-tag>
              </div>
              <div class="goal-actions">
                <el-button type="text" size="small" @click="updateProgress(goal)">
                  <el-icon><Edit /></el-icon>
                  更新进度
                </el-button>
                <el-dropdown trigger="click">
                  <el-button type="text" size="small">
                    <el-icon><MoreFilled /></el-icon>
                  </el-button>
                  <template #dropdown>
                    <el-dropdown-menu>
                      <el-dropdown-item @click="editGoal(goal)">
                        <el-icon><Edit /></el-icon>
                        编辑目标
                      </el-dropdown-item>
                      <el-dropdown-item @click="pauseGoal(goal)">
                        <el-icon><VideoPause /></el-icon>
                        暂停目标
                      </el-dropdown-item>
                      <el-dropdown-item divided @click="deleteGoal(goal.id)">
                        <el-icon><Delete /></el-icon>
                        删除目标
                      </el-dropdown-item>
                    </el-dropdown-menu>
                  </template>
                </el-dropdown>
              </div>
            </div>
            
            <div class="goal-description">{{ goal.description }}</div>
            
            <div class="goal-progress">
              <div class="progress-info">
                <span>{{ goal.currentValue }}/{{ goal.targetValue }} {{ goal.unit }}</span>
                <span class="progress-percentage">{{ progressPercentage(goal) }}%</span>
              </div>
              <el-progress 
                :percentage="progressPercentage(goal)"
                :status="goal.currentValue >= goal.targetValue ? 'success' : undefined"
              />
            </div>
            
            <div class="goal-meta">
              <div class="meta-item">
                <el-icon><Calendar /></el-icon>
                <span>{{ formatDateRange(goal.startDate, goal.endDate) }}</span>
              </div>
              <div class="meta-item">
                <el-icon><Clock /></el-icon>
                <span>剩余 {{ getRemainingDays(goal.endDate) }} 天</span>
              </div>
            </div>
          </div>
        </transition-group>
      </div>
    </div>

    <!-- 历史目标 -->
    <div class="historical-goals">
      <el-collapse>
        <el-collapse-item title="📈 历史目标" name="history">
          <div v-if="completedGoals.length === 0" class="empty-state">
            <p>暂无已完成的目标</p>
          </div>
          <div v-else class="goals-list">
            <div v-for="goal in completedGoals" :key="goal.id" class="goal-item completed">
              <div class="goal-header">
                <div class="goal-info">
                  <span class="goal-title">{{ goal.title }}</span>
                  <el-tag type="success" size="small">已完成</el-tag>
                </div>
                <div class="completion-date">
                  完成于 {{ formatDate(goal.completedAt) }}
                </div>
              </div>
              <div class="goal-description">{{ goal.description }}</div>
              <div class="goal-result">
                最终完成：{{ goal.currentValue }}/{{ goal.targetValue }} {{ goal.unit }}
                ({{ progressPercentage(goal) }}%)
              </div>
            </div>
          </div>
        </el-collapse-item>
      </el-collapse>
    </div>

    <!-- 新增/编辑目标对话框 -->
    <el-dialog 
      v-model="showAddGoalDialog"
      @closed="resetGoalForm"
      :title="editingGoal ? '编辑目标' : '新增写作目标'"
      width="500px"
    >
      <el-form :model="goalForm" :rules="goalRules" ref="goalFormRef" label-width="80px">
        <el-form-item label="目标标题" prop="title">
          <el-input v-model="goalForm.title" placeholder="例如：每日写作1000字" />
        </el-form-item>
        
        <el-form-item label="目标类型" prop="type">
          <el-select v-model="goalForm.type" placeholder="选择目标类型" @change="changeGoalType">
            <el-option label="每日目标" value="daily" />
            <el-option label="每周目标" value="weekly" />
            <el-option label="每月目标" value="monthly" />
            <el-option label="总字数" value="total" />
            <el-option label="章节数" value="chapters" />
            <el-option label="连续天数" value="streak_days" />
            <el-option label="自定义期间" value="custom" />
          </el-select>
        </el-form-item>
        
        <el-form-item label="目标描述">
          <el-input 
            v-model="goalForm.description" 
            type="textarea" 
            :rows="2"
            placeholder="描述你的写作目标"
          />
        </el-form-item>
        
        <el-form-item label="目标数值" prop="targetValue">
          <el-input-number 
            v-model="goalForm.targetValue" 
            :min="1" 
            :max="100000"
            placeholder="目标数值"
          />
        </el-form-item>
        
        <el-form-item label="计量单位" prop="unit">
          <el-select v-model="goalForm.unit" placeholder="选择单位" :disabled="['chapters', 'streak_days'].includes(goalForm.type)">
            <el-option label="字" value="字" />
            <el-option label="页" value="页" />
            <el-option label="章节" value="章节" />
            <el-option label="章" value="章" />
            <el-option label="小时" value="小时" />
            <el-option label="天" value="天" />
          </el-select>
          <span v-if="editingGoal && goalForm.unit !== editingGoal.unit">更改单位后当前进度归零，历史记录保留。</span>
        </el-form-item>
        
        <el-form-item v-if="usesDateRange(goalForm.type)" label="时间范围" prop="dateRange">
          <el-date-picker
            v-model="goalForm.dateRange"
            type="daterange"
            range-separator="至"
            start-placeholder="开始日期"
            end-placeholder="结束日期"
            format="YYYY-MM-DD"
            value-format="YYYY-MM-DD"
          />
        </el-form-item>
      </el-form>
      
      <template #footer>
        <span class="dialog-footer">
          <el-button @click="showAddGoalDialog = false">取消</el-button>
          <el-button type="primary" :loading="goalsStore.pending > 0" @click="saveGoal">保存</el-button>
        </span>
      </template>
    </el-dialog>

    <!-- 更新进度对话框 -->
    <el-dialog v-model="showProgressDialog" title="更新进度" width="400px">
      <el-form :model="progressForm" label-width="80px">
        <el-form-item label="当前进度">
          <el-input-number 
            v-model="progressForm.value" 
            :min="0" 
            :max="progressForm.maxValue"
          />
          <span class="ml-2">{{ progressForm.unit }}</span>
        </el-form-item>
        
        <el-form-item label="进度说明">
          <el-input 
            v-model="progressForm.note" 
            type="textarea" 
            :rows="2"
            placeholder="记录今天的写作情况"
          />
        </el-form-item>
      </el-form>
      
      <template #footer>
        <span class="dialog-footer">
          <el-button @click="showProgressDialog = false">取消</el-button>
          <el-button type="primary" :loading="goalsStore.pending > 0" @click="saveProgress">保存</el-button>
        </span>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { storeToRefs } from 'pinia'
import type { FormInstance, TagProps } from 'element-plus'
import type { WritingGoal } from '@/types/management'
import type { WriterTimestamp } from '@/types/writer'
import { resolveGoalUnit, toGoalDate } from '@/utils/writingGoals'
import { useWritingGoalsStore } from '@/stores/writingGoals'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Calendar, Clock, TrendCharts, Trophy, Edit, MoreFilled, VideoPause, Delete, Rank } from '@element-plus/icons-vue'

const goalsStore = useWritingGoalsStore()
const { goals, activeGoals, streak: currentStreak } = storeToRefs(goalsStore)
const showAddGoalDialog = ref(false)
const showProgressDialog = ref(false)
const editingGoal = ref<WritingGoal | null>(null)
const updatingGoal = ref<WritingGoal | null>(null)
const goalFormRef = ref<FormInstance>()
const sortMode = ref(false)
const draggedIndex = ref<number | null>(null)
const emptyForm = () => ({ title: '', type: 'daily', description: '', targetValue: 1000, unit: '字', dateRange: null as string[] | null })
const goalForm = ref(emptyForm())
const progressForm = ref({ value: 0, maxValue: 0, unit: '', note: '' })
const goalRules = {
  title: [{ required: true, message: '请输入目标标题', trigger: 'blur' }],
  type: [{ required: true, message: '请选择目标类型', trigger: 'change' }],
  targetValue: [{ required: true, message: '请输入目标数值', trigger: 'blur' }],
  unit: [{ required: true, message: '请选择计量单位', trigger: 'change' }],
  dateRange: [{ required: true, message: '请选择时间范围', trigger: 'change' }],
}
const completedGoals = computed(() => goals.value.filter(goal => goal.status === 'completed'))
const periodProgress = (type: string) => {
  const goal = activeGoals.value.find(item => item.type === type)
  return { current: goal?.currentValue ?? 0, target: goal?.targetValue ?? 0, unit: goal?.unit ?? '字' }
}
const todayProgress = computed(() => periodProgress('daily'))
const weeklyProgress = computed(() => periodProgress('weekly'))
const monthlyProgress = computed(() => periodProgress('monthly'))
const formatDate = (date: WriterTimestamp | undefined) => date ? toGoalDate(date).toLocaleDateString('zh-CN') : ''
const dateInput = (date: WriterTimestamp) => {
  const d = toGoalDate(date)
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}
const formatDateRange = (start: WriterTimestamp, end: WriterTimestamp) => `${formatDate(start)} - ${formatDate(end)}`
const getRemainingDays = (date: WriterTimestamp) => Math.max(0, Math.ceil((toGoalDate(date).getTime() - Date.now()) / 86_400_000))
const getGoalTypeText = (type: string) => ({ daily: '每日', weekly: '每周', monthly: '每月', total: '总字数', chapters: '章节数', streak_days: '连续天数', custom: '自定义' }[type] ?? '目标')
const getGoalTypeColor = (type: string): TagProps['type'] => ({ daily: 'primary', weekly: 'success', monthly: 'warning', custom: 'info' } as Record<string, TagProps['type']>)[type] ?? 'info'
const progressPercentage = (goal: WritingGoal) => Math.min(100, Math.max(0, Math.round(goal.currentValue / goal.targetValue * 100)))
const resetGoalForm = () => { goalForm.value = emptyForm(); editingGoal.value = null; goalFormRef.value?.clearValidate() }
const openAddGoal = () => { resetGoalForm(); showAddGoalDialog.value = true }
const usesDateRange = (type: string) => ['custom', 'chapters', 'streak_days', 'total'].includes(type)
const changeGoalType = (type: string) => {
  goalForm.value.unit = resolveGoalUnit(type, type === 'custom' ? goalForm.value.unit : undefined)
}
const editGoal = (goal: WritingGoal) => {
  editingGoal.value = goal
  goalForm.value = { title: goal.title, type: goal.type, description: goal.description ?? '', targetValue: goal.targetValue, unit: resolveGoalUnit(goal.type, goal.unit), dateRange: usesDateRange(goal.type) ? [dateInput(goal.startDate), dateInput(goal.endDate)] : null }
  showAddGoalDialog.value = true
}
const updateProgress = (goal: WritingGoal) => {
  updatingGoal.value = goal
  progressForm.value = { value: goal.currentValue, maxValue: Math.max(goal.targetValue, goal.currentValue), unit: goal.unit ?? '字', note: '' }
  showProgressDialog.value = true
}
const pauseGoal = async (goal: WritingGoal) => {
  try { await ElMessageBox.confirm('确定要暂停这个目标吗？', '确认暂停', { type: 'warning' }) } catch { return }
  try { await goalsStore.pauseGoal(goal.id); ElMessage.success('目标已暂停') } catch (error) { ElMessage.error(String(error)) }
}
const deleteGoal = async (id: WritingGoal['id']) => {
  try { await ElMessageBox.confirm('确定要删除这个目标吗？', '确认删除', { type: 'warning' }) } catch { return }
  try { await goalsStore.deleteGoal(id); ElMessage.success('目标删除成功') } catch (error) { ElMessage.error(String(error)) }
}
const saveGoal = async () => {
  if (!goalFormRef.value) return
  try { await goalFormRef.value.validate() } catch { return }
  const form = goalForm.value
  const start = new Date(); start.setHours(0,0,0,0)
  const end = new Date(start)
  if (form.type === 'weekly') { start.setDate(start.getDate() - start.getDay()); end.setTime(start.getTime()); end.setDate(end.getDate() + 6) }
  if (form.type === 'monthly') { start.setDate(1); end.setMonth(start.getMonth()+1,0) }
  const existing = editingGoal.value?.type === form.type ? editingGoal.value : null
  const startDate = usesDateRange(form.type) ? form.dateRange?.[0] : existing?.startDate || dateInput(start)
  const endDate = usesDateRange(form.type) ? form.dateRange?.[1] : existing?.endDate || dateInput(end)
  if (!startDate || !endDate) return
  try {
    const editing = editingGoal.value !== null
    await goalsStore.saveGoal({ title: form.title, type: form.type, description: form.description, targetValue: form.targetValue, unit: form.unit, startDate, endDate }, editingGoal.value?.id)
    showAddGoalDialog.value = false
    ElMessage.success(editing ? '目标更新成功' : '目标创建成功')
  } catch (error) { ElMessage.error(`保存目标失败：${String(error)}`) }
}
const saveProgress = async () => {
  if (!updatingGoal.value) return
  try {
    await goalsStore.recordProgress(updatingGoal.value.id, progressForm.value.value, 'total', progressForm.value.note)
    showProgressDialog.value = false
    updatingGoal.value = null
    ElMessage.success('进度更新成功')
  } catch (error) { ElMessage.error(`保存进度失败：${String(error)}`) }
}
const toggleSortMode = () => { sortMode.value = !sortMode.value }
const onDragStart = (event: DragEvent, index: number) => { draggedIndex.value = index; if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move' }
const onDragOver = (event: DragEvent) => { event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = 'move' }
const onDrop = async (event: DragEvent, target: number) => {
  event.preventDefault()
  const source = draggedIndex.value; draggedIndex.value = null
  if (source === null || source === target) return
  const ids = activeGoals.value.map(goal => goal.id)
  const [id] = ids.splice(source,1); ids.splice(target,0,id)
  try { await goalsStore.reorderGoals(ids); ElMessage.success('排序已更新') } catch (error) { ElMessage.error(`保存排序失败：${String(error)}`) }
}
</script>

<style scoped>
.writing-goals {
  padding: 20px;
}

.goals-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.goals-overview {
  margin-bottom: 30px;
}

.overview-card {
  display: flex;
  align-items: center;
  padding: 20px;
  background: var(--el-bg-color);
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  transition: transform 0.2s;
}

.overview-card:hover {
  transform: translateY(-2px);
}

.card-icon {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-right: 16px;
  font-size: 20px;
  color: white;
}

.card-icon.daily {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
}

.card-icon.weekly {
  background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
}

.card-icon.monthly {
  background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%);
}

.card-icon.streak {
  background: linear-gradient(135deg, #43e97b 0%, #38f9d7 100%);
}

.card-content {
  flex: 1;
}

.card-title {
  font-size: 14px;
  color: #666;
  margin-bottom: 4px;
}

.card-value {
  font-size: 24px;
  font-weight: bold;
  color: #333;
  margin-bottom: 2px;
}

.card-subtitle {
  font-size: 12px;
  color: #999;
}

.active-goals {
  margin-bottom: 30px;
}

.goals-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.goal-item {
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-light);
  border-radius: 8px;
  padding: 20px;
  transition: all 0.3s;
}

.goal-item:hover {
  border-color: var(--brand-500);
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.1);
}

.goal-item.completed {
  background: var(--brand-50);
  border-color: var(--el-color-success);
}

.goal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.goal-info {
  display: flex;
  align-items: center;
  gap: 12px;
}

.goal-title {
  font-size: 16px;
  font-weight: bold;
  color: var(--el-text-color-primary);
}

.goal-actions {
  display: flex;
  gap: 8px;
}

.goal-description {
  color: var(--el-text-color-regular);
  margin-bottom: 16px;
  line-height: 1.5;
}

.goal-progress {
  margin-bottom: 12px;
}

.progress-info {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
  font-size: 14px;
}

.progress-percentage {
  font-weight: bold;
  color: var(--brand-500);
}

.goal-meta {
  display: flex;
  gap: 20px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.meta-item {
  display: flex;
  align-items: center;
  gap: 4px;
}

.completion-date {
  font-size: 12px;
  color: var(--el-color-success);
}

.goal-result {
  font-size: 14px;
  color: var(--el-text-color-regular);
  background: var(--el-fill-color-light);
  padding: 8px 12px;
  border-radius: 4px;
  margin-top: 8px;
}

.empty-state {
  text-align: center;
  padding: 40px;
  color: var(--el-text-color-secondary);
}

.ml-2 {
  margin-left: 8px;
}

/* 排序相关样式 */
.active-goals-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.goals-controls {
  display: flex;
  gap: 8px;
}

.sort-active {
  background: var(--brand-500) !important;
  color: white !important;
}

.sort-tip {
  margin-bottom: 16px;
}

.sortable-goals {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.goal-item.sortable {
  cursor: move;
  border: 2px dashed transparent;
  transition: all 0.3s ease;
}

.goal-item.sortable:hover {
  border-color: var(--brand-500);
  box-shadow: 0 4px 12px rgba(64, 158, 255, 0.2);
}

.goal-item.sortable[draggable="true"]:active {
  opacity: 0.8;
  transform: rotate(2deg);
}

/* 拖拽动画 */
.list-move,
.list-enter-active,
.list-leave-active {
  transition: all 0.3s ease;
}

.list-enter-from,
.list-leave-to {
  opacity: 0;
  transform: translateX(30px);
}

.list-leave-active {
  position: absolute;
  width: 100%;
}
</style>
