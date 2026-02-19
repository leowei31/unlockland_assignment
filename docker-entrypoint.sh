#!/bin/sh
set -e

echo "Fetching Vancouver parcel data..."
npm run data:fetch

echo "Starting application..."
exec "$@"
