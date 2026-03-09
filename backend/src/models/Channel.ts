import mongoose, { Schema, Document } from 'mongoose';

export interface IChannel extends Document {
  dsUuid: string;
  channelName: string;
  customerId: string;
  clusterId: string;
  redisInstance: string;
  streamType: 'HLS' | 'DASH';
  gManaPlayerUrl: string;
  sourcePlayerUrl: string;
  isVip: boolean;
  isActive: boolean;
  lastAlarmAt?: Date;
  alarmCount60Min: number;
  createdAt: Date;
  updatedAt: Date;
}

const ChannelSchema = new Schema<IChannel>(
  {
    dsUuid: { type: String, required: true, unique: true },
    channelName: { type: String, required: true },
    customerId: { type: String, required: true },
    clusterId: { type: String, required: true },
    redisInstance: { type: String, required: true },
    streamType: { type: String, enum: ['HLS', 'DASH'], default: 'HLS' },
    gManaPlayerUrl: { type: String, default: '' },
    sourcePlayerUrl: { type: String, default: '' },
    isVip: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
    lastAlarmAt: { type: Date },
    alarmCount60Min: { type: Number, default: 0 },
  },
  { timestamps: true },
);

ChannelSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 90 });
ChannelSchema.index({ dsUuid: 1 });
ChannelSchema.index({ customerId: 1 });

export const Channel = mongoose.model<IChannel>('Channel', ChannelSchema);
