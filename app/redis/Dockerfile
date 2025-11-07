FROM redis:8.2-alpine

RUN apk add --no-cache gettext

COPY redis-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/redis-entrypoint.sh

COPY redis.conf.template /usr/local/etc/redis/redis.conf.template

# Удаляем все модули Redis (если они есть)
RUN rm -rf /usr/local/lib/redis/modules/*.so

ENTRYPOINT ["redis-entrypoint.sh"]