import mongoose, { Schema, Document } from 'mongoose';

export interface IEscalationLog extends Document {
  incidentId: string;
  dsUuid: string;
  reason: string;
  escalatedTo: string;
  channels: Array<'whatsapp' | 'email'>;
  messageContent: string;
  sentAt: Date;
  acknowledged: boolean;
  acknowledgedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const EscalationLogSchema = new Schema<IEscalationLog>(
  {
    incidentId: { type: String, required: true, index: true },
    dsUuid: { type: String, required: true },
    reason: { type: String, required: true },
    escalatedTo: { type: String, required: true },
    channels: { type: [String], enum: ['whatsapp', 'email'], default: ['whatsapp'] },
    messageContent: { type: String, required: true },
    sentAt: { type: Date, default: Date.now },
    acknowledged: { type: Boolean, default: false },
    acknowledgedAt: { type: Date },
  },
  { timestamps: true },
);

EscalationLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 90 });

export const EscalationLog = mongoose.model<IEscalationLog>('EscalationLog', EscalationLogSchema);
