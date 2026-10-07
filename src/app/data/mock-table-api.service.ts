import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { delay } from 'rxjs/operators';
import {
  AggregateResult,
  CellEdit,
  CellSaveResult,
  CellValue,
  ExternalChangeResponse,
  FilterCondition,
  FilterGroup,
  FilterNode,
  GroupSummary,
  QueryRequest,
  QueryResult,
  SaveCellsResponse,
  TableRow,
} from '../types/table.models';

const REGIONS = ['华东', '华南', '华北', '西南', '西北', '东北'];
const CATEGORIES = ['云服务', '智能硬件', '企业软件', '数据服务', '运维支持'];
const OWNERS = ['陈嘉', '林月', '周砺', '许宁', '韩舟', '顾清', '沈河', '陆遥'];
const STATUSES: TableRow['status'][] = ['待审核', '进行中', '已发货', '已完成', '异常'];

function cellKey(id: string, field: keyof TableRow): string {
  return `${id}::${String(field)}`;
}

@Injectable({ providedIn: 'root' })
export class MockTableApiService {
  private readonly rows: TableRow[] = this.createRows(50000);
  private readonly rowMap = new Map<string, TableRow>();
  /** 服务端数据版本：每次成功保存或外部变更后递增 */
  private dataVersion = 1;
  /** 各单元格的服务端版本，键为 `${id}::${field}`，未记录时视为 1 */
  private readonly cellVersions = new Map<string, number>();

  constructor() {
    this.rows.forEach((row) => this.rowMap.set(row.id, row));
  }

  query(request: QueryRequest): Observable<QueryResult> {
    const startedAt = performance.now();
    const filtered = this.filterRows(this.rows, request.filter, request.search);
    const sorted = this.sortRows(filtered, request.sort);
    const groups = request.groupBy ? this.groupRows(sorted, request.groupBy) : [];

    let pageRows: TableRow[];
    let total: number;

    if (request.treeMode) {
      const roots = sorted.filter((row) => row.parentId === null);
      total = roots.length;
      const rootPage = roots.slice(
        request.page * request.pageSize,
        (request.page + 1) * request.pageSize,
      );
      pageRows = rootPage.flatMap((root) => [
        root,
        ...(request.expandedIds.includes(root.id)
          ? sorted.filter((row) => row.parentId === root.id)
          : []),
      ]);
    } else {
      total = sorted.length;
      pageRows = sorted.slice(
        request.page * request.pageSize,
        (request.page + 1) * request.pageSize,
      );
    }

    const versions: Record<string, number> = {};
    for (const row of pageRows) {
      for (const field of Object.keys(row) as Array<keyof TableRow>) {
        if (field === 'id' || field === 'parentId') continue;
        versions[cellKey(row.id, field)] = this.getVersion(row.id, field);
      }
    }

    const elapsedMs = Math.max(8, Math.round(performance.now() - startedAt + 18));
    return of({
      rows: pageRows,
      total,
      aggregates: this.aggregate(sorted),
      groups,
      elapsedMs,
      sessionId: request.sessionId,
      dataVersion: this.dataVersion,
      versions,
    }).pipe(delay(request.page > 8 ? 120 : 55));
  }

  /**
   * 批量保存：逐项独立裁决，成功的先入库，失败项保留为冲突。
   * 不会因为某一项失败而回退其他已成功的项。
   */
  saveCells(edits: CellEdit[]): Observable<SaveCellsResponse> {
    const results: CellSaveResult[] = [];
    let applied = false;

    for (const edit of edits) {
      const row = this.rowMap.get(edit.id);
      if (!row) {
        results.push({
          id: edit.id,
          field: edit.field,
          status: 'missing',
          localValue: edit.value,
          serverValue: null,
          serverVersion: 0,
          baseVersion: edit.baseVersion,
        });
        continue;
      }

      const currentVersion = this.getVersion(edit.id, edit.field);
      if (edit.baseVersion !== currentVersion) {
        // 落后于服务端：不覆盖，留在冲突区等待重试
        results.push({
          id: edit.id,
          field: edit.field,
          status: 'conflict',
          localValue: edit.value,
          serverValue: row[edit.field],
          serverVersion: currentVersion,
          baseVersion: edit.baseVersion,
        });
        continue;
      }

      row[edit.field] = edit.value;
      const nextVersion = currentVersion + 1;
      this.cellVersions.set(cellKey(edit.id, edit.field), nextVersion);
      applied = true;
      results.push({
        id: edit.id,
        field: edit.field,
        status: 'saved',
        value: edit.value,
        version: nextVersion,
        localValue: edit.value,
        baseVersion: edit.baseVersion,
      });
    }

    if (applied) {
      this.dataVersion += 1;
    }

    return of({ results, dataVersion: this.dataVersion }).pipe(delay(40));
  }

  /**
   * 模拟“另一个标签页”先保存了一批单元格：
   * 随机提升若干单元格的服务端版本并改动其值，
   * 使本会话基于旧版本的待提交项在保存时落入冲突区。
   */
  simulateExternalChange(pendingKeys: string[]): Observable<ExternalChangeResponse> {
    const affected: string[] = [];
    const versions: Record<string, number> = {};

    // 保证至少有一个待提交项被“对面标签页”抢先保存
    const shuffled = [...pendingKeys].sort(() => Math.random() - 0.5);
    const bumpCount = pendingKeys.length
      ? Math.max(1, Math.ceil(pendingKeys.length * (0.4 + Math.random() * 0.4)))
      : 0;
    for (const key of shuffled.slice(0, bumpCount)) {
      const [id, field] = this.splitKey(key);
      if (this.bumpCell(id, field)) {
        affected.push(key);
        versions[key] = this.getVersion(id, field);
      }
    }

    // 再随机改动若干单元格，模拟服务端其他写入
    for (let i = 0; i < 3; i += 1) {
      const row = this.rows[Math.floor(Math.random() * this.rows.length)];
      const fields: Array<keyof TableRow> = ['amount', 'quantity', 'margin', 'status', 'owner'];
      const field = fields[Math.floor(Math.random() * fields.length)];
      const key = cellKey(row.id, field);
      if (this.bumpCell(row.id, field)) {
        if (!affected.includes(key)) {
          affected.push(key);
          versions[key] = this.getVersion(row.id, field);
        }
      }
    }

    if (affected.length) {
      this.dataVersion += 1;
    }

    return of({ affected, dataVersion: this.dataVersion, versions }).pipe(delay(30));
  }

  getDatasetSize(): number {
    return this.rows.length;
  }

  private getVersion(id: string, field: keyof TableRow): number {
    return this.cellVersions.get(cellKey(id, field)) ?? 1;
  }

  private splitKey(key: string): [string, keyof TableRow] {
    const idx = key.indexOf('::');
    return [key.slice(0, idx), key.slice(idx + 2) as keyof TableRow];
  }

  /** 提升单元格版本并改动其值，返回是否成功 */
  private bumpCell(id: string, field: keyof TableRow): boolean {
    const row = this.rowMap.get(id);
    if (!row) return false;
    const key = cellKey(id, field);
    const nextVersion = this.getVersion(id, field) + 1;
    this.cellVersions.set(key, nextVersion);

    if (field === 'amount') {
      row.amount = Math.round((row.amount + 1000 + Math.random() * 49000) * 100) / 100;
    } else if (field === 'quantity') {
      row.quantity = row.quantity + 1 + Math.floor(Math.random() * 20);
    } else if (field === 'margin') {
      row.margin = Math.round((row.margin + Math.random() * 5) * 10) / 10;
    } else if (field === 'status') {
      const idx = STATUSES.indexOf(row.status);
      row.status = STATUSES[(idx + 1) % STATUSES.length];
    } else if (field === 'owner') {
      const current = OWNERS.indexOf(row.owner);
      row.owner = OWNERS[(current + 1 + Math.floor(Math.random() * (OWNERS.length - 1))) % OWNERS.length];
    }
    // 字符串字段（customer/orderNo 等）只提升版本、不改值，
    // 同样会因版本落后在保存时被裁决为冲突。
    return true;
  }

  private filterRows(rows: TableRow[], filter: FilterGroup, search: string): TableRow[] {
    const normalizedSearch = search.trim().toLowerCase();
    return rows.filter((row) => {
      const matchesExpression = this.evaluateNode(row, filter);
      if (!matchesExpression || !normalizedSearch) {
        return matchesExpression;
      }
      return [row.orderNo, row.customer, row.region, row.category, row.owner, row.status]
        .some((value) => String(value).toLowerCase().includes(normalizedSearch));
    });
  }

  private evaluateNode(row: TableRow, node: FilterNode): boolean {
    if (node.kind === 'condition') {
      return this.evaluateCondition(row, node);
    }
    if (!node.children.length) {
      return true;
    }
    return node.logic === 'and'
      ? node.children.every((child) => this.evaluateNode(row, child))
      : node.children.some((child) => this.evaluateNode(row, child));
  }

  private evaluateCondition(row: TableRow, condition: FilterCondition): boolean {
    const rawValue = row[condition.field];
    const filterValue = condition.value.trim();
    if (!filterValue) {
      return true;
    }
    if (condition.operator === 'in') {
      return filterValue.split(',').map((item) => item.trim()).includes(String(rawValue));
    }
    const left = typeof rawValue === 'number' ? rawValue : String(rawValue ?? '').toLowerCase();
    const rightNumber = Number(filterValue);
    const right = typeof rawValue === 'number' ? rightNumber : filterValue.toLowerCase();

    switch (condition.operator) {
      case 'contains':
        return String(left).includes(String(right));
      case 'equals':
        return left === right;
      case 'notEquals':
        return left !== right;
      case 'gt':
        return Number(left) > Number(right);
      case 'gte':
        return Number(left) >= Number(right);
      case 'lt':
        return Number(left) < Number(right);
      case 'lte':
        return Number(left) <= Number(right);
      default:
        return true;
    }
  }

  private sortRows(rows: TableRow[], sort: QueryRequest['sort']): TableRow[] {
    if (!sort) {
      return rows;
    }
    const direction = sort.direction === 'asc' ? 1 : -1;
    return [...rows].sort((left, right) => {
      const a = left[sort.field];
      const b = right[sort.field];
      if (typeof a === 'number' && typeof b === 'number') {
        return (a - b) * direction;
      }
      return String(a).localeCompare(String(b), 'zh-CN') * direction;
    });
  }

  private groupRows(rows: TableRow[], groupBy: keyof TableRow): GroupSummary[] {
    const buckets = new Map<string, TableRow[]>();
    rows.forEach((row) => {
      const key = String(row[groupBy] ?? '未分类');
      const bucket = buckets.get(key) ?? [];
      bucket.push(row);
      buckets.set(key, bucket);
    });
    return [...buckets.entries()]
      .map(([key, bucket]) => ({
        key,
        count: bucket.length,
        aggregate: this.aggregate(bucket),
      }))
      .sort((left, right) => right.aggregate.amount - left.aggregate.amount);
  }

  private aggregate(rows: TableRow[]): AggregateResult {
    if (!rows.length) {
      return { amount: 0, quantity: 0, averageMargin: 0 };
    }
    const amount = rows.reduce((sum, row) => sum + row.amount, 0);
    const quantity = rows.reduce((sum, row) => sum + row.quantity, 0);
    const averageMargin = rows.reduce((sum, row) => sum + row.margin, 0) / rows.length;
    return {
      amount: Math.round(amount * 100) / 100,
      quantity,
      averageMargin: Math.round(averageMargin * 10) / 10,
    };
  }

  private createRows(count: number): TableRow[] {
    const rows: TableRow[] = [];
    const parentEvery = 7;
    for (let index = 0; index < count; index += 1) {
      const id = `ORD-${String(index + 1).padStart(6, '0')}`;
      const parentIndex = index % parentEvery === 0 ? null : index - (index % parentEvery);
      const day = (index * 7) % 27 + 1;
      const hour = index % 24;
      const status = STATUSES[(index * 13) % STATUSES.length];
      rows.push({
        id,
        orderNo: `SO-${String(202600000 + index).padStart(9, '0')}`,
        customer: `${['远海', '星图', '柏川', '新域', '启明', '屹辰'][index % 6]}${['科技', '制造', '物流', '能源'][index % 4]}有限公司`,
        region: REGIONS[(index * 5) % REGIONS.length],
        category: CATEGORIES[(index * 3) % CATEGORIES.length],
        owner: OWNERS[(index * 11) % OWNERS.length],
        amount: Math.round((6800 + ((index * 7919) % 940000) / 3) * 100) / 100,
        quantity: 1 + ((index * 17) % 280),
        margin: Math.round((6 + ((index * 29) % 310) / 10) * 10) / 10,
        status,
        updatedAt: `2026-09-${String(day).padStart(2, '0')} ${String(hour).padStart(2, '0')}:${String((index * 7) % 60).padStart(2, '0')}`,
        parentId: parentIndex === null ? null : `ORD-${String(parentIndex + 1).padStart(6, '0')}`,
      });
    }
    return rows;
  }
}
