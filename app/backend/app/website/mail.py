"""Verification delivery. Tokens are never returned to the browser or logs."""

from email.message import EmailMessage
import smtplib
import ssl

from fastapi import HTTPException


def send_token(config, email: str, token: str, purpose: str):
    if not config.mail_enabled:
        raise HTTPException(503, "Почтовая отправка ещё не настроена администратором")
    label = "Сброс пароля" if purpose == "reset" else "Подтверждение почты"
    fragment = "reset" if purpose == "reset" else "verify"
    message = EmailMessage()
    message["Subject"] = f"AnimeSoul — {label}"
    message["From"] = config.smtp_from
    message["To"] = email
    message.set_content(
        f"{label}\n\n{config.origin}/account#{fragment}={token}\n\n"
        "Ссылка одноразовая и действует ограниченное время. Если вы не запрашивали её, проигнорируйте письмо."
    )
    try:
        if config.smtp_port == 465:
            smtp = smtplib.SMTP_SSL(config.smtp_host, config.smtp_port, timeout=15, context=ssl.create_default_context())
        else:
            smtp = smtplib.SMTP(config.smtp_host, config.smtp_port, timeout=15)
        with smtp:
            if config.smtp_tls and config.smtp_port != 465:
                smtp.starttls(context=ssl.create_default_context())
            if config.smtp_user:
                smtp.login(config.smtp_user, config.smtp_password)
            smtp.send_message(message)
    except (OSError, smtplib.SMTPException) as error:
        raise HTTPException(503, "Не удалось отправить письмо. Попробуйте позже.") from error
