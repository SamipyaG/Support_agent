import mongoose, { Schema, Document } from 'mongoose';

export interface ICustomer extends Document {
  customerId: string;
  name: string;
  isVip: boolean;
  waitingTimeSeconds: number;
  whatsappGroupId: string;
  contactEmail: string;
  notificationChannels: Array<'email' | 'whatsapp'>;
  channels: string[];
  createdAt: Date;
  updatedAt: Date;
}

const CustomerSchema = new Schema<ICustomer>(
  {
    customerId: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    isVip: { type: Boolean, default: false },
    waitingTimeSeconds: { type: Number, default: 300 },
    whatsappGroupId: { type: String, default: '' },
    contactEmail: { type: String, default: '' },
    notificationChannels: {
      type: [String],
      enum: ['email', 'whatsapp'],
      default: ['email'],
    },
    channels: [{ type: String }],
  },
  { timestamps: true },
);

CustomerSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 90 });

export const Customer = mongoose.model<ICustomer>('Customer', CustomerSchema);
