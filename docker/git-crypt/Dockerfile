FROM alpine:latest as build

ARG GIT_CRYPT_VERSION="0.6.0-1"

RUN apk --no-cache --update add \
      ca-certificates \
      bash \
      curl \
      git \
      g++ \
      gnupg \
      make \
      openssh \
      openssl \
      openssl-dev


RUN mkdir /var/tmp/git-crypt-debian && \
    curl -L https://github.com/AGWA/git-crypt/archive/debian/$GIT_CRYPT_VERSION.tar.gz \
      | tar xzv \
          --strip-components 1 \
          -C /var/tmp/git-crypt-debian

RUN cd /var/tmp/git-crypt-debian \
    && make \
    && make install PREFIX=/usr/local \
    && rm -rf /var/tmp/git-crypt

# Build another image from the beginning to reduce image size
FROM alpine:latest as cli

RUN apk --no-cache --update add \
      git \
      g++ \
      gnupg

COPY --from=build /usr/local/bin/git-crypt /usr/local/bin/git-crypt
COPY unlock.sh /unlock.sh
RUN chmod +x /unlock.sh

CMD [ "/unlock.sh" ]
