# 企业订单数据中心

基于 Angular 20、Angular Material、NgRx、RxJS 与 Angular CDK 的大型数据表格示例。

## 运行

```bash
export PATH="/Applications/ChatGPT.app/Contents/Resources/cua_node/bin:$PATH"
corepack pnpm install
corepack pnpm dev
```

生产构建：

```bash
corepack pnpm build
```

## 已实现

- 5 万行本地 mock 数据，通过服务类模拟服务端分页、排序、筛选、分组与聚合
- 可嵌套“且 / 或”条件组、全文搜索和字段运算表达式
- CDK 虚拟滚动列表，支持紧凑、标准、宽松三种行高
- 列宽拖拽、列显隐、列排序、列固定
- 行选择、分组统计卡片、树形展开、单元格双击内联编辑
- NgRx 管理查询状态、选择状态、列状态、视图及未提交单元格变更
- 查询会话版本化：筛选 / 排序 / 分页变化后旧查询结果直接失效，页面只展示新条件的行与聚合
- 单元格级版本裁决：批量保存按 baseVersion 校验，落后的值不覆盖服务端，进入冲突区等待重试或放弃
- 批量保存部分成功：成功项先入库，冲突项单独重试，已完成部分不回退
- 跨标签页数据同步：模拟服务端状态写入 localStorage，其他标签页保存后本页旧结果自动失效并刷新
- 会话快照恢复：筛选、排序、未提交修改与冲突项持久化，刷新或保存失败后可继续编辑
- 三段式 CSV 导出：分别列出已保存值、待提交值与冲突项
- 列宽、筛选、排序、分组等保存为视图并写入 localStorage
- 方向键、Enter、Space、Ctrl/Cmd+A、Escape 等键盘操作
- CSV 导出、查询耗时、加载状态与结果统计
