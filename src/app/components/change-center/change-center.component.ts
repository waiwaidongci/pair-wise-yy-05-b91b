import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Store } from '@ngrx/store';
import { CellValue, ConflictItem, TableRow } from '../../types/table.models';
import * as TableActions from '../../stores/table.actions';
import {
  selectConflictList,
  selectPendingList,
  selectSaving,
} from '../../stores/table.selectors';

interface PendingRow {
  id: string;
  field: keyof TableRow;
  value: CellValue;
  baseVersion: number;
}

@Component({
  selector: 'app-change-center',
  standalone: true,
  imports: [
    CommonModule,
    MatButtonModule,
    MatDialogModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatTabsModule,
    MatTooltipModule,
  ],
  template: `
    <h2 mat-dialog-title>
      <mat-icon>sync_alt</mat-icon>
      变更中心
      @if (saving()) {
        <mat-spinner diameter="18" class="title-spinner" />
      }
    </h2>

    <mat-dialog-content class="change-center">
      <mat-tab-group>
        <mat-tab>
          <ng-template mat-tab-label>
            <mat-icon>edit_note</mat-icon>
            待提交
            @if (pendingList().length) {
              <span class="tab-badge">{{ pendingList().length }}</span>
            }
          </ng-template>

          @if (!pendingList().length) {
            <div class="empty">
              <mat-icon>done_all</mat-icon>
              <span>没有待提交的修改。双击单元格即可编辑。</span>
            </div>
          } @else {
            <div class="list-actions">
              <span class="muted">共 {{ pendingList().length }} 项未保存修改，保存时按单元格版本独立裁决。</span>
              <button mat-stroked-button color="warn" type="button" (click)="discardAllPending()">
                全部放弃
              </button>
            </div>
            <ul class="change-list">
              @for (item of pendingList(); track item.id + '::' + item.field) {
                <li class="change-item">
                  <div class="change-item__main">
                    <span class="change-item__id">{{ item.id }}</span>
                    <span class="change-item__field">{{ fieldLabel(item.field) }}</span>
                    <span class="change-item__arrow">→</span>
                    <span class="change-item__value">{{ formatValue(item.value) }}</span>
                  </div>
                  <span class="change-item__ver" matTooltip="编辑时基于的服务端版本">
                    v{{ item.baseVersion }}
                  </span>
                </li>
              }
            </ul>
          }
        </mat-tab>

        <mat-tab>
          <ng-template mat-tab-label>
            <mat-icon>warning_amber</mat-icon>
            冲突区
            @if (conflictList().length) {
              <span class="tab-badge tab-badge--warn">{{ conflictList().length }}</span>
            }
          </ng-template>

          @if (!conflictList().length) {
            <div class="empty">
              <mat-icon>verified_user</mat-icon>
              <span>没有冲突。落后于服务端的修改会留在这里等待重试。</span>
            </div>
          } @else {
            <div class="list-actions">
              <span class="muted">
                共 {{ conflictList().length }} 项冲突：本地值未覆盖服务端，可重试或放弃。
              </span>
              <button mat-flat-button color="primary" type="button" (click)="retryAll()">
                全部重试
              </button>
              <button mat-stroked-button color="warn" type="button" (click)="discardAllConflicts()">
                全部放弃
              </button>
            </div>
            <ul class="change-list">
              @for (item of conflictList(); track item.id + '::' + item.field) {
                <li class="change-item change-item--conflict">
                  <div class="change-item__main">
                    <span class="change-item__id">{{ item.id }}</span>
                    <span class="change-item__field">{{ fieldLabel(item.field) }}</span>
                    <span class="change-item__arrow">→</span>
                    <span class="change-item__value change-item__value--local">
                      {{ formatValue(item.localValue) }}
                    </span>
                    <span class="change-item__vs">服务端</span>
                    <span class="change-item__value change-item__value--server">
                      {{ formatValue(item.serverValue) }}
                    </span>
                  </div>
                  <div class="change-item__actions">
                    <span class="change-item__ver" matTooltip="服务端当前版本">
                      v{{ item.serverVersion }}
                    </span>
                    <button
                      mat-icon-button
                      color="primary"
                      matTooltip="以服务端最新版本为基准重试"
                      (click)="retry(item)"
                    >
                      <mat-icon>refresh</mat-icon>
                    </button>
                    <button
                      mat-icon-button
                      color="warn"
                      matTooltip="放弃本地修改"
                      (click)="discard(item)"
                    >
                      <mat-icon>close</mat-icon>
                    </button>
                  </div>
                </li>
              }
            </ul>
          }
        </mat-tab>
      </mat-tab-group>
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-button type="button" mat-dialog-close>关闭</button>
      <button
        mat-flat-button
        color="primary"
        type="button"
        [disabled]="!pendingList().length || saving()"
        (click)="saveAll()"
      >
        @if (saving()) {
          <mat-spinner diameter="16" />
        } @else {
          <mat-icon>save</mat-icon>
        }
        保存全部待提交
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    h2[mat-dialog-title] {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 0;
      font-size: 18px;
    }
    .title-spinner {
      margin-left: 4px;
    }
    .change-center {
      min-width: 640px;
      max-width: 720px;
    }
    .tab-badge {
      display: inline-grid;
      min-width: 18px;
      height: 18px;
      margin-left: 6px;
      padding: 0 5px;
      place-items: center;
      border-radius: 999px;
      background: #175cd3;
      color: #fff;
      font-size: 11px;
    }
    .tab-badge--warn {
      background: #b42318;
    }
    .empty {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 36px 8px;
      color: #667085;
      font-size: 13px;
    }
    .list-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 12px 0;
    }
    .list-actions .muted {
      flex: 1;
      font-size: 12px;
    }
    .change-list {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .change-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 8px 10px;
      border: 1px solid #e4e7ec;
      border-radius: 8px;
      background: #fafbfc;
    }
    .change-item--conflict {
      border-color: #fecdca;
      background: #fef3f2;
    }
    .change-item__main {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      font-size: 13px;
    }
    .change-item__id {
      color: #667085;
      font-variant-numeric: tabular-nums;
    }
    .change-item__field {
      font-weight: 600;
    }
    .change-item__arrow {
      color: #98a2b3;
    }
    .change-item__value {
      padding: 1px 7px;
      border-radius: 4px;
      background: #eef4ff;
      color: #175cd3;
    }
    .change-item__value--local {
      background: #fff;
      color: #b42318;
      text-decoration: line-through;
    }
    .change-item__value--server {
      background: #ecfdf3;
      color: #027a48;
    }
    .change-item__vs {
      color: #98a2b3;
      font-size: 11px;
    }
    .change-item__actions {
      display: flex;
      align-items: center;
      gap: 2px;
    }
    .change-item__ver {
      color: #98a2b3;
      font-size: 11px;
      font-variant-numeric: tabular-nums;
    }
    mat-dialog-actions button mat-icon,
    mat-dialog-actions button mat-spinner {
      margin-right: 4px;
    }
  `],
})
export class ChangeCenterComponent {
  private readonly store = inject(Store);
  private readonly dialogRef = inject(MatDialogRef<ChangeCenterComponent>);

  readonly pendingList = this.store.selectSignal(selectPendingList);
  readonly conflictList = this.store.selectSignal(selectConflictList);
  readonly saving = this.store.selectSignal(selectSaving);

  fieldLabel(field: keyof TableRow): string {
    const found = this.columns.find((column) => column.key === field);
    return found?.label ?? String(field);
  }

  formatValue(value: CellValue): string {
    if (value === null || value === undefined || value === '') return '（空）';
    if (typeof value === 'number') return value.toLocaleString('zh-CN');
    return String(value);
  }

  saveAll(): void {
    this.store.dispatch(TableActions.saveCells());
  }

  retry(item: ConflictItem): void {
    this.store.dispatch(TableActions.retryConflict({ id: item.id, field: item.field }));
  }

  retryAll(): void {
    this.store.dispatch(TableActions.retryAllConflicts());
  }

  discard(item: ConflictItem): void {
    this.store.dispatch(TableActions.discardConflict({ id: item.id, field: item.field }));
  }

  discardAllPending(): void {
    this.store.dispatch(TableActions.discardAllPending());
  }

  discardAllConflicts(): void {
    this.store.dispatch(TableActions.discardAllConflicts());
  }

  private readonly columns: Array<{ key: keyof TableRow; label: string }> = [
    { key: 'orderNo', label: '订单编号' },
    { key: 'customer', label: '客户名称' },
    { key: 'region', label: '区域' },
    { key: 'category', label: '产品线' },
    { key: 'owner', label: '负责人' },
    { key: 'amount', label: '合同金额' },
    { key: 'quantity', label: '数量' },
    { key: 'margin', label: '毛利率' },
    { key: 'status', label: '状态' },
    { key: 'updatedAt', label: '更新时间' },
  ];
}
