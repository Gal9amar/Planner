import sys
import json
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

sys.stdin.reconfigure(encoding='utf-8')
data = json.loads(sys.stdin.read())

message = MIMEMultipart("alternative")
message["From"]    = data["from_email"]
message["To"]      = data["to_email"]
message["Subject"] = data["subject"]
message.attach(MIMEText(data["body_html"], "html", "utf-8"))

host = data.get("smtp_host", "localhost")
port = data.get("smtp_port", 25)

with smtplib.SMTP(host, port) as server:
    if data.get("smtp_user") and data.get("smtp_password"):
        server.starttls()
        server.login(data["smtp_user"], data["smtp_password"])
    server.sendmail(data["from_email"], data["to_email"], message.as_string())

print("OK")
