#!/bin/bash

# إعداد شهادة SSL باستخدام Let's Encrypt

# تثبيت Certbot
sudo apt install certbot python3-certbot-nginx -y

# الحصول على شهادة SSL
sudo certbot --nginx -d your-domain.com -d www.your-domain.com

# اختبار التجديد التلقائي
sudo certbot renew --dry-run
