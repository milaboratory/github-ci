FROM ubuntu:20.04 as aws-installer

RUN apt-get update \
    && apt-get install --yes unzip

ADD "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" /installer/awscli.zip
WORKDIR /installer

RUN unzip awscli.zip

FROM ubuntu:20.04

COPY --from=aws-installer /installer /aws-cli-installer
RUN /aws-cli-installer/aws/install \
    && rm -rf /aws-cli-installer

RUN apt-get update \
    && apt-get install --yes \
        libdigest-sha-perl \
    && apt-get clean

COPY ./entrypoint.sh /
RUN chmod +x /entrypoint.sh

ENTRYPOINT [ "/entrypoint.sh" ]
