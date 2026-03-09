import mongoose, { Schema, Document } from 'mongoose';

export interface IMemoryPattern extends Document {
  patternKey: string;
  dsUuid?: string;
  clusterId?: string;
  customerId?: string;
  patternType: 'recurring_alarm' | 'resource_spike' | 'stream_error' | 'restart_success' | 'escalation';
  description: string;
  occurrences: number;
  lastSeenAt: Date;
  successfulAction?: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const MemoryPatternSchema = new Schema<IMemoryPattern>(
  {
    patternKey: { type: String, required: true, unique: true },
    dsUuid: { type: String },
    clusterId: { type: String },
    customerId: { type: String },
    patternType: {
      type: String,
      enum: ['recurring_alarm', 'resource_spike', 'stream_error', 'restart_success', 'escalation'],
      required: true,
    },
    description: { type: String, required: true },
    occurrences: { type: Number, default: 1 },
    lastSeenAt: { type: Date, default: Date.now },
    successfulAction: { type: String },
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

MemoryPatternSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 90 });
MemoryPatternSchema.index({ dsUuid: 1 });
MemoryPatternSchema.index({ patternType: 1 });

export const MemoryPattern = mongoose.model<IMemoryPattern>('MemoryPattern', MemoryPatternSchema);
