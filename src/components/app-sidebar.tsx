import * as React from "react"

import { NavDocuments } from "@/components/nav-documents"
import { NavMain } from "@/components/nav-main"
import { NavUser } from "@/components/nav-user"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import {
  LayoutDashboardIcon,
  ListIcon,
  BarChartIcon,
  FolderIcon,
  ShieldCheckIcon,
  DatabaseIcon,
  FileBarChartIcon,
  FileIcon,
  CommandIcon,
  SendIcon,
  UsersIcon,
} from "lucide-react"

const data = {
  navMain: [
    {
      title: "Dashboard",
      url: "#dashboard",
      icon: (
        <LayoutDashboardIcon />
      ),
    },
    {
      title: "Ingestion",
      url: "#ingestion",
      icon: (
        <ListIcon />
      ),
    },
    {
      title: "Review Queue",
      url: "#review-queue",
      icon: (
        <BarChartIcon />
      ),
    },
    {
      title: "Publish Queue",
      url: "#publish-queue",
      icon: (
        <SendIcon />
      ),
    },
    {
      title: "Operational Docs",
      url: "#operational-docs",
      icon: (
        <FolderIcon />
      ),
    },
    {
      title: "Audit Trail",
      url: "#audit-trail",
      icon: (
        <ShieldCheckIcon />
      ),
    },
  ],

  documents: [
    {
      name: "SOP Library",
      url: "#sops",
      icon: (
        <DatabaseIcon />
      ),
    },
    {
      name: "MOP Library",
      url: "#mops",
      icon: (
        <FileBarChartIcon />
      ),
    },
    {
      name: "EOP Library",
      url: "#eops",
      icon: (
        <FileIcon />
      ),
    },
  ],
}

export function AppSidebar({
  userProfile,
  user,
  onSignOut,
  ...props
}: React.ComponentProps<typeof Sidebar> & {
  userProfile?: {
    role: string
    department?: string
  } | null
  user: {
    name: string
    email: string
    avatar: string
  }
  onSignOut: () => void
}) {
  const filteredNavMain = React.useMemo(() => {
    const role = userProfile?.role || "Viewer"
    const items = [...data.navMain]

    if (role === "Admin") {
      items.push({
        title: "User Management",
        url: "#user-management",
        icon: (
          <UsersIcon />
        ),
      })
    }

    return items.filter((item) => {
      const title = item.title
      if (title === "Dashboard") return true
      if (title === "Ingestion") {
        return ["Admin", "Reviewer", "Contributor"].includes(role)
      }
      if (title === "Review Queue") {
        return ["Admin", "Approver", "Reviewer"].includes(role)
      }
      if (title === "Publish Queue") {
        return ["Admin", "Approver"].includes(role)
      }
      if (title === "Operational Docs") {
        return ["Admin", "Approver", "Reviewer"].includes(role)
      }
      if (title === "Audit Trail") {
        return ["Admin"].includes(role)
      }
      if (title === "User Management") {
        return role === "Admin"
      }
      return true
    })
  }, [userProfile])

  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              className="data-[slot=sidebar-menu-button]:p-1.5!"
              render={<a href="#" />}
            >
              <CommandIcon className="size-5!" />
              <span className="text-base font-semibold">What is a Director</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={filteredNavMain} />
        <NavDocuments items={data.documents} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser
          user={{
            ...user,
            role: userProfile?.role || "Viewer",
            department: userProfile?.department,
          }}
          onSignOut={onSignOut}
        />
      </SidebarFooter>
    </Sidebar>
  )
}
