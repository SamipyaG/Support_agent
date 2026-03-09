import mongoose, { Schema, Document } from 'mongoose';

export interface IActionLog extends Document {
  incidentId: string;
  dsUuid: string;
  action: string;
  cluster: string;
  status: 'success' | 'failed' | 'skipped';
  requestPayload: Record<string, unknown>;
  responsePayload: Record<string, unknown>;
  errorMessage?: string;
  durationMs: number;
  executedBy: 'auto' | 'manual';
  approvalId?: string;
  createdAt: Date;
  updatedAt: Date;
}

const ActionLogSchema = new Schema<IActionLog>(
  {
    incidentId: { type: String, required: true, index: true },
    dsUuid: { type: String, required: true },
    action: { type: String, required: true },
    cluster: { type: String, required: true },
    status: { type: String, enum: ['success', 'failed', 'skipped'], required: true },
    requestPayload: { type: Schema.Types.Mixed, default: {} },
    responsePayload: { type: Schema.Types.Mixed, default: {} },
    errorMessage: { type: String },
    durationMs: { type: Number, default: 0 },
    executedBy: { type: String, enum: ['auto', 'manual'], default: 'auto' },
    approvalId: { type: String },
  },
  { timestamps: true },
);

ActionLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 90 });
ActionLogSchema.index({ incidentId: 1 });

export const ActionLog = mongoose.model<IActionLog>('ActionLog', ActionLogSchema);
