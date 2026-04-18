import { Schema, model } from 'mongoose';

const ClientQuerySchema = new Schema({
  organizationId: { type: Schema.Types.ObjectId, ref: 'Organization' },
  projectId:      { type: Schema.Types.ObjectId, ref: 'Project' },
  clientId:       { type: String, required: true },   // User._id of the client
  title:          { type: String, required: true },
  description:    { type: String },
  status:         { type: String, enum: ['open', 'in_progress', 'resolved', 'closed'], default: 'open' },
  priority:       { type: String, enum: ['low', 'medium', 'high', 'urgent'], default: 'medium' },
  assignedTo:     { type: String },                   // User._id of the team member handling it
  replies: [{
    authorId:   String,
    authorName: String,
    content:    String,
    createdAt:  { type: Date, default: Date.now },
  }],
}, { timestamps: true });

export default model('ClientQuery', ClientQuerySchema);
