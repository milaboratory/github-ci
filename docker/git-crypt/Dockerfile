FROM alpine:latest

ARG GIT_CRYPT_VERSION="0.6.0-1"

RUN apk --update add \
      ca-certificates \
      bash \
      curl \
      git \
      g++ \
      gnupg \
      make \
      openssh \
      openssl \
      openssl-dev \
    && rm -rf /var/cache/apk/*


RUN mkdir /var/tmp/git-crypt-debian && \
    curl -L https://github.com/AGWA/git-crypt/archive/debian/$GIT_CRYPT_VERSION.tar.gz \
      | tar xzv \
          --strip-components 1 \
          -C /var/tmp/git-crypt-debian

RUN cd /var/tmp/git-crypt-debian \
    && make \
    && make install PREFIX=/usr/local \
    && rm -rf /var/tmp/git-crypt

COPY unlock.sh /unlock.sh

CMD [ "/unlock.sh" ]
