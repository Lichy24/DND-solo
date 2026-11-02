#!/bin/bash
set -e

mongosh -u "$MONGO_INITDB_ROOT_USERNAME" -p "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin <<EOF

db = db.getSiblingDB('dnd_db');

db.createCollection('users');
db.createCollection('sessions');
db.createCollection('characters');
db.createCollection('partys');
db.createCollection('models');

db.getCollection('models').insertMany([
  { id: ObjectId().toString(), label: "Qwen2.5", name: "Qwen/Qwen2.5-1.5B-Instruct" },
  { id: ObjectId().toString(), label: "Phi-3-mini", name: "microsoft/Phi-3-mini-4k-instruct" },
  { id: ObjectId().toString(), label: "TinyLlama", name: "TinyLlama/TinyLlama-1.1B-Chat-v1.0" },
  { id: ObjectId().toString(), label: "SmolLM3", name: "HuggingFaceTB/SmolLM3-1.5B" }
]);

db.createUser({
  user: "${MONGO_APP_USER}",
  pwd: "${MONGO_APP_PASS}",
  roles: [
    {
      role: 'readWrite',
      db: 'dnd_db',
    },
  ],
});

print('--- INITIALIZATION COMPLETE ---');
EOF
