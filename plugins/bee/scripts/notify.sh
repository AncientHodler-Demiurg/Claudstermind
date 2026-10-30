#!/bin/bash
# Cross-platform native notification.
# Usage: notify.sh "title" "message"
# Always exits 0 — notifications are best-effort, never block.
#
# Windows note: the original AppendChild toast pattern failed on PowerShell 5.1
# with "Collection was modified; enumeration operation may not execute" (silently
# swallowed). This version builds the toast XML as a string and uses LoadXml,
# which works reliably on PS 5.1+ and PS 7. Fix contributed by downstream user.

TITLE="${1:-Claude Code}"
MESSAGE="${2:-Notification}"

# Escape for embedding inside an XML element (and the surrounding single-quoted PS string).
xml_escape() {
    local s="$1"
    s="${s//&/&amp;}"
    s="${s//</&lt;}"
    s="${s//>/&gt;}"
    s="${s//\"/&quot;}"
    s="${s//\'/&apos;}"
    printf '%s' "$s"
}

case "$(uname -s)" in
    Darwin)
        # Pass title and message as arguments to avoid shell injection.
        osascript \
            -e 'on run argv' \
            -e 'display notification (item 2 of argv) with title (item 1 of argv)' \
            -e 'end run' \
            -- "$TITLE" "$MESSAGE" 2>/dev/null
        ;;
    Linux)
        if command -v notify-send &>/dev/null; then
            notify-send "$TITLE" "$MESSAGE" 2>/dev/null
        fi
        ;;
    MINGW*|MSYS*|CYGWIN*)
        T=$(xml_escape "$TITLE")
        M=$(xml_escape "$MESSAGE")
        MSYS_NO_PATHCONV=1 powershell.exe -NoProfile -Command "
            try {
                [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > \$null
                [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] > \$null
                \$xml = New-Object Windows.Data.Xml.Dom.XmlDocument
                \$xml.LoadXml('<toast><visual><binding template=\"ToastText02\"><text id=\"1\">$T</text><text id=\"2\">$M</text></binding></visual></toast>')
                \$toast = [Windows.UI.Notifications.ToastNotification]::new(\$xml)
                [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Claude Code').Show(\$toast)
            } catch {}
        " >/dev/null 2>&1
        ;;
esac

exit 0
