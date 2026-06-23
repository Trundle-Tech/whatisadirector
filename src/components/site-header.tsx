import * as React from "react"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { BellIcon, Trash2Icon, InboxIcon, CheckIcon, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { markNotificationAsRead, deleteNotification } from "@/lib/firestore-store"

export function SiteHeader({
  title = "Dashboard",
  userProfile,
  notifications = [],
}: {
  title?: string
  userProfile?: {
    role: string
    department?: string
  } | null
  notifications?: any[]
}) {
  const [isOpen, setIsOpen] = React.useState(false)
  const dropdownRef = React.useRef<HTMLDivElement>(null)

  const unreadCount = React.useMemo(() => {
    return notifications.filter((n) => !n.read).length
  }, [notifications])

  // Close dropdown when clicking outside
  React.useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside)
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside)
    }
  }, [isOpen])

  return (
    <header className="relative flex h-(--header-height) shrink-0 items-center gap-2 border-b bg-background transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-(--header-height) z-40">
      <div className="flex w-full items-center justify-between px-4 lg:px-6">
        {/* Left side: title */}
        <div className="flex items-center gap-1 lg:gap-2">
          <SidebarTrigger className="-ml-1" />
          <Separator
            orientation="vertical"
            className="mx-2 h-4 data-vertical:self-auto"
          />
          <h1 className="text-base font-semibold">{title}</h1>
        </div>

        {/* Right side: department and notifications */}
        <div className="flex items-center gap-3">
          {userProfile?.department && (
            <Badge variant="outline" className="hidden sm:inline-flex text-xs bg-muted/50 border-muted font-medium py-0.5 px-2">
              {userProfile.department}
            </Badge>
          )}

          {/* Notifications Bell */}
          <div className="relative" ref={dropdownRef}>
            <Button
              variant="ghost"
              size="icon"
              className="relative h-9 w-9 rounded-lg hover:bg-muted cursor-pointer"
              onClick={() => setIsOpen(!isOpen)}
            >
              <BellIcon className="size-4.5 text-foreground" />
              {unreadCount > 0 && (
                <span className="absolute top-1.5 right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-[9px] font-bold text-destructive-foreground animate-pulse">
                  {unreadCount}
                </span>
              )}
            </Button>

            {/* Notifications Dropdown */}
            {isOpen && (
              <div className="absolute right-0 mt-2 w-80 sm:w-96 rounded-xl border bg-card text-card-foreground shadow-2xl p-0 overflow-hidden animate-in fade-in-0 slide-in-from-top-2 duration-150 z-50">
                <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/20">
                  <h3 className="text-sm font-semibold flex items-center gap-1.5">
                    <span>Notifications</span>
                    {unreadCount > 0 && (
                      <Badge className="bg-primary hover:bg-primary text-[10px] py-0 px-1.5 leading-none h-4.5">
                        {unreadCount} New
                      </Badge>
                    )}
                  </h3>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 rounded-md hover:bg-muted cursor-pointer"
                    onClick={() => setIsOpen(false)}
                  >
                    <X className="size-3.5" />
                  </Button>
                </div>

                <div className="max-h-[300px] overflow-y-auto divide-y divide-border">
                  {notifications.length > 0 ? (
                    notifications.map((notif) => (
                      <div
                        key={notif.id}
                        className={`flex items-start gap-2.5 p-3.5 transition-colors cursor-pointer text-left ${
                          !notif.read ? "bg-primary/5 hover:bg-primary/10" : "hover:bg-muted/30"
                        }`}
                        onClick={async () => {
                          if (!notif.read) {
                            try {
                              await markNotificationAsRead(notif.id)
                            } catch (e) {
                              console.error("Failed to mark read:", e)
                            }
                          }
                        }}
                      >
                        {/* Unread indicator dot */}
                        <div className="mt-1 shrink-0">
                          {!notif.read ? (
                            <span className="flex h-2 w-2 rounded-full bg-primary" />
                          ) : (
                            <CheckIcon className="size-3.5 text-muted-foreground/50" />
                          )}
                        </div>

                        {/* Content */}
                        <div className="flex-1 min-w-0">
                          <p className={`text-xs text-foreground leading-normal ${!notif.read ? "font-medium" : "text-foreground/80"}`}>
                            {notif.message}
                          </p>
                          <span className="text-[10px] text-muted-foreground block mt-1">
                            {new Date(notif.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>

                        {/* Actions */}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-md shrink-0 cursor-pointer"
                          onClick={async (e) => {
                            e.stopPropagation()
                            try {
                              await deleteNotification(notif.id)
                            } catch (error) {
                              console.error("Failed to delete notification:", error)
                            }
                          }}
                        >
                          <Trash2Icon className="size-3.5" />
                        </Button>
                      </div>
                    ))
                  ) : (
                    <div className="flex flex-col items-center justify-center py-10 px-4 text-center text-muted-foreground">
                      <InboxIcon className="size-8 stroke-1 text-muted-foreground/75 mb-2" />
                      <p className="text-xs font-medium">All caught up!</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">No notifications yet.</p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  )
}
