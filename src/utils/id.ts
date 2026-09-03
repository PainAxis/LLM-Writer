let counter = 0

/** 生成数值型唯一 ID（时间戳 + 随机数 + 自增，避免快速操作时重复） */
export function generateUniqueId(): number {
  counter = (counter + 1) % 10000
  return Date.now() + Math.floor(Math.random() * 10000) + counter
}
