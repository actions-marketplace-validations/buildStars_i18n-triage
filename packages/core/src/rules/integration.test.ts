import { describe, expect, it } from 'vitest'

import { parseSource } from '../parsers'
import type { FileContext, TriageResult } from '../types'
import { excludeI18nCalls, triage } from './index'

/** 端到端：源码 → 解析 → 剔除 i18n 调用 → 分类 */
function run(source: string, relativePath: string) {
  const ctx: FileContext = { relativePath }
  const nodes = parseSource(source, ctx)
  const kept = excludeI18nCalls(nodes)
  return {
    excluded: nodes.length - kept.length,
    results: triage(kept, ctx),
  }
}

const brief = (r: TriageResult) => `${r.category} ${r.node.value} (${r.matchedBy})`

describe('端到端：views/Order.vue', () => {
  const src = `<script setup lang="ts">
import { showToast } from 'vant'
import { useI18n } from 'vue-i18n'
// 注释：已下架
const { t } = useI18n()
const STATUS = { '已下架': 1, label: '部门' }
enum Mode { Fast = '快速' }
function save() {
  console.error('加载失败')
  showToast(t('已下架'))
  showToast('保存成功')
  ElMessage({ message: '对象式提示', type: 'error' })
  const tip = '裸字面量'
}
</script>

<template>
  <!-- <p>注释里的元素</p> -->
  <h1 title="标题">{{ t('页面标题') }}</h1>
  <input placeholder="请输入订单号" data-track="埋点名" />
  <p>暂无数据</p>
  <van-button @click="showToast('点击了')">按钮</van-button>
</template>

<style scoped>
h1::after { content: '样式中文'; }
</style>`

  const { excluded, results } = run(src, 'src/views/Order.vue')

  it('excludes the two t() calls before classification', () => {
    expect(excluded).toBe(2)
  })

  it('classifies every remaining string exactly as the rule table says', () => {
    expect(results.map(brief)).toEqual([
      'D_INTERNAL_KEY 已下架 (d-internal-key)', // { '已下架': 1 }
      'A_UI_TEXT 部门 (a-ui-text)', // { label: '部门' }: label is a display prop → confident A
      'D_INTERNAL_KEY 快速 (d-internal-key)', // enum member
      'B_DEBUG_LOG 加载失败 (b-debug-log)', // console.error
      'A_UI_TEXT 保存成功 (a-ui-text)', // showToast('...')
      'A_UI_TEXT 对象式提示 (a-ui-text)', // ElMessage({ message })
      'A_UI_TEXT 裸字面量 (fallback)',
      'A_UI_TEXT 标题 (a-ui-text)', // title="标题"
      'A_UI_TEXT 请输入订单号 (a-ui-text)', // placeholder
      'D_INTERNAL_KEY 埋点名 (d-internal-key)', // data-track: tracking attribute → internal key
      'A_UI_TEXT 暂无数据 (a-ui-text)', // text node
      'A_UI_TEXT 点击了 (a-ui-text)', // @click="showToast('点击了')"
      'A_UI_TEXT 按钮 (a-ui-text)', // text node
    ])
  })

  it('never surfaces comments or <style> content', () => {
    const values = results.map((r) => r.node.value)
    expect(values.some((v) => v.includes('注释'))).toBe(false)
    expect(values.some((v) => v.includes('样式'))).toBe(false)
  })
})

describe('端到端：constants/product.ts', () => {
  const src = `// 商品字典
export const COLOR_MAP = { '红色': 1, '蓝色': 2, '绿色': 3 }
export const COLOR_OPTIONS = [
  { label: '红色', value: 1 },
  { label: '蓝色', value: 2 },
  { label: '绿色', value: 3 },
]
export const STATUS_TEXT = { 0: '待发货', 1: '已发货', 2: '已下架' }
export const SINGLE = { label: '只有一个' }
console.log('字典加载完成')`

  const { excluded, results } = run(src, 'src/constants/product.ts')

  it('has nothing to exclude', () => {
    expect(excluded).toBe(0)
  })

  it('keys are D, option/map values are C, a lone value falls back to A, logs are B', () => {
    expect(results.map(brief)).toEqual([
      'D_INTERNAL_KEY 红色 (d-internal-key)',
      'D_INTERNAL_KEY 蓝色 (d-internal-key)',
      'D_INTERNAL_KEY 绿色 (d-internal-key)',
      'C_DICT 红色 (c-dict)',
      'C_DICT 蓝色 (c-dict)',
      'C_DICT 绿色 (c-dict)',
      'C_DICT 待发货 (c-dict)',
      'C_DICT 已发货 (c-dict)',
      'C_DICT 已下架 (c-dict)',
      'A_UI_TEXT 只有一个 (a-ui-text)', // { label } below the dict threshold → still a display prop
      'B_DEBUG_LOG 字典加载完成 (b-debug-log)',
    ])
  })
})

describe('端到端：同一份对象在 views/ 下不是字典', () => {
  it('reports the same options list as A when the file is not under a dict directory', () => {
    const src = `export const COLOR_OPTIONS = [{ label: '红色', value: 1 }, { label: '蓝色', value: 2 }, { label: '绿色', value: 3 }]`
    const { results } = run(src, 'src/views/product.ts')
    expect(results.map((r) => r.category)).toEqual(['A_UI_TEXT', 'A_UI_TEXT', 'A_UI_TEXT'])
    // label 是展示 prop，所以是规则命中的 A 而不是待确认；关键是它不是 C
    expect(results.every((r) => r.matchedBy === 'a-ui-text')).toBe(true)
  })
})
