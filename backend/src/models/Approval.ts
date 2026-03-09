import mongoose, { Schema, Document } from 'mongoose';

export type ApprovalDecision = 'pending' | 'approved' | 'rejected' | 'timeout';

export interface IApproval extends Document {
  incidentId: string;
  proposedAction: string;
  actionDetails: Record<string, unknown>;
  decision: ApprovalDecision;
  decidedBy?: string;
  decidedAt?: Date;
  timeoutSeconds: number;
  autoExecuted: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const ApprovalSchema = new Schema<IApproval>(
  {
    incidentId: { type: String, required: true, index: true },
    proposedAction: { type: String, required: true },
    actionDetails: { type: Schema.Types.Mixed, default: {} },
    decision: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'timeout'],
      default: 'pending',
    },
    decidedBy: { type: String },
    decidedAt: { type: Date },
    timeoutSeconds: { type: Number, default: 10 },
    autoExecuted: { type: Boolean, default: false },
  },
  { timestamps: true },
);

ApprovalSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 90 });

export const Approval = mongoose.model<IApproval>('Approval', ApprovalSchema);
