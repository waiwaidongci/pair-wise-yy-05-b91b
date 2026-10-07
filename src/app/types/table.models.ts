export type CellValue = string | number | boolean | null;

export interface TableRow {
  id: string;
  orderNo: string;
  customer: string;
  region: string;
  category: string;
  owner: string;
  amount: number;
  quantity: number;
  margin: number;
  status: '待审核' | '进行中' | '已发货' | '已完成' | '异常';
  updatedAt: string;
  parentId: string | null;
  [key: string]: CellValue;
}

export type FilterOperator =
  | 'contains'
  | 'equals'
  | 'notEquals'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'in';

export interface FilterCondition {
  kind: 'condition';
  id: string;
  field: keyof TableRow;
  operator: FilterOperator;
  value: string;
}

export interface FilterGroup {
  kind: 'group';
  id: string;
  logic: 'and' | 'or';
  children: FilterNode[];
}

export type FilterNode = FilterCondition | FilterGroup;

export type SortDirection = 'asc' | 'desc';

export interface SortState {
  field: keyof TableRow;
  direction: SortDirection;
}

export interface ColumnDefinition {
  key: keyof TableRow;
  label: string;
  width: number;
  minWidth: number;
  align?: 'left' | 'right' | 'center';
  editable?: boolean;
  formatter?: 'currency' | 'percent' | 'date' | 'status';
  type: 'text' | 'number' | 'date' | 'enum' | 'boolean';
}

export interface QueryRequest {
  page: number;
  pageSize: number;
  sort: SortState | null;
  filter: FilterGroup;
  groupBy: keyof TableRow | null;
  treeMode: boolean;
  expandedIds: string[];
  search: string;
  /** 查询会话令牌：每次发起新查询时递增，旧会话结果直接失效 */
  sessionId: number;
  /** 数据版本令牌：结果基于哪一版服务端数据，版本不符说明数据已变化 */
  dataVersion: number;
}

export interface AggregateResult {
  amount: number;
  quantity: number;
  averageMargin: number;
}

export interface GroupSummary {
  key: string;
  count: number;
  aggregate: AggregateResult;
}

export interface QueryResult {
  rows: TableRow[];
  total: number;
  aggregates: AggregateResult;
  groups: GroupSummary[];
  elapsedMs: number;
  sessionId: number;
  dataVersion: number;
  /** 返回行各单元格的当前服务端版本，作为后续编辑的 baseVersion */
  versions: Record<string, number>;
}

export interface SavedView {
  id: string;
  name: string;
  createdAt: string;
  pageSize: number;
  visibleColumns: Array<keyof TableRow>;
  columnWidths: Record<string, number>;
  pinnedColumns: Array<keyof TableRow>;
  sort: SortState | null;
  filter: FilterGroup;
  groupBy: keyof TableRow | null;
  treeMode: boolean;
}

// === 单元格编辑与版本仲裁 ===

/** 待提交的单元格变更：记录新值以及基于哪个服务端版本 */
export interface PendingCell {
  value: CellValue;
  baseVersion: number;
}

export type ConflictReason = 'conflict' | 'missing';

/** 冲突项：本地值落后于服务端，等待重试或放弃 */
export interface ConflictItem {
  id: string;
  field: keyof TableRow;
  localValue: CellValue;
  serverValue: CellValue;
  serverVersion: number;
  baseVersion: number;
  reason: ConflictReason;
}

export interface CellEdit {
  id: string;
  field: keyof TableRow;
  value: CellValue;
  baseVersion: number;
}

export type CellSaveStatus = 'saved' | 'conflict' | 'missing';

export interface CellSaveResult {
  id: string;
  field: keyof TableRow;
  status: CellSaveStatus;
  /** 保存成功后的新值 */
  value?: CellValue;
  /** 保存成功后的新版本 */
  version?: number;
  /** 本次提交的本地值 */
  localValue: CellValue;
  /** 冲突时服务端的当前值 */
  serverValue?: CellValue;
  /** 冲突时服务端的当前版本 */
  serverVersion?: number;
  baseVersion: number;
}

export interface SaveCellsResponse {
  results: CellSaveResult[];
  dataVersion: number;
}

export interface ExternalChangeResponse {
  affected: string[];
  dataVersion: number;
  versions: Record<string, number>;
}

// === 会话持久化 ===

export interface PersistedSnapshot {
  schemaVersion: number;
  dataVersion: number;
  query: {
    page: number;
    pageSize: number;
    sort: SortState | null;
    filter: FilterGroup;
    search: string;
    groupBy: keyof TableRow | null;
    treeMode: boolean;
    expandedIds: string[];
  };
  snapshot: {
    rows: TableRow[];
    total: number;
    aggregates: AggregateResult;
    groups: GroupSummary[];
  };
  cellVersions: Record<string, number>;
  dirtyCells: Record<string, PendingCell>;
  conflicts: Record<string, ConflictItem>;
  savedViews: SavedView[];
}

export interface TableState {
  /** 查询会话号：每次发起查询递增，用于作废旧会话的迟到结果 */
  querySession: number;
  /** 服务端数据版本号：保存或外部变更后递增，用于作废旧数据上的查询结果 */
  dataVersion: number;
  /** 恢复标记：刷新后首查无条件接受结果并对齐版本 */
  recovering: boolean;
  /** 服务端快照行（不含本地覆盖），作为“已保存值”导出与冲突回退的基准 */
  serverRows: TableRow[];
  /** 展示行：serverRows 叠加待提交覆盖后的结果 */
  rows: TableRow[];
  total: number;
  groups: GroupSummary[];
  aggregates: AggregateResult;
  loading: boolean;
  /** 当前展示快照是否已过期（服务端数据已变化） */
  stale: boolean;
  error: string | null;
  page: number;
  pageSize: number;
  sort: SortState | null;
  filter: FilterGroup;
  search: string;
  groupBy: keyof TableRow | null;
  treeMode: boolean;
  expandedIds: string[];
  selectedIds: string[];
  visibleColumns: Array<keyof TableRow>;
  columnWidths: Record<string, number>;
  pinnedColumns: Array<keyof TableRow>;
  density: 'compact' | 'standard' | 'comfortable';
  elapsedMs: number;
  savedViews: SavedView[];
  activeViewId: string | null;
  /** 各单元格已知的服务端版本，键为 `${id}::${field}` */
  cellVersions: Record<string, number>;
  /** 待提交变更，键为 `${id}::${field}` */
  dirtyCells: Record<string, PendingCell>;
  /** 冲突项，键为 `${id}::${field}` */
  conflicts: Record<string, ConflictItem>;
  saving: boolean;
  saveError: string | null;
  hydrated: boolean;
  lastSavedAt: string | null;
}
