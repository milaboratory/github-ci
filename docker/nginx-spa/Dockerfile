FROM nginx:1.21.6-alpine

RUN mkdir --parent /var/www/spa
RUN chown -R nginx:nginx /var/www

COPY single-page-application.conf /etc/nginx/conf.d/default.conf

# To run container with application, mount
# application files into '/var/www/spa' path.
