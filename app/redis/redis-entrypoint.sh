#!/bin/sh
set -e

rm -f /usr/local/lib/redis/modules/*.so

# Заменяем плейсхолдер в конфиге на реальный пароль
envsubst < /usr/local/etc/redis/redis.conf.template > /usr/local/etc/redis/redis.conf

exec redis-server /usr/local/etc/redis/redis.conf