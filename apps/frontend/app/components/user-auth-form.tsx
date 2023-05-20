"use client"

import * as React from "react"

import { cn } from "ui/utils"
import { Button } from "ui/components/button"
import { Input } from "ui/components/input"
import { Label } from "ui/components/label"
import { Icons } from "ui/icons"
import { usePlanning } from "../../lib/planning-context"
import { usePathname, useRouter } from "next/navigation"

interface UserAuthFormProps extends React.HTMLAttributes<HTMLDivElement> {
  action: string
}

export function UserAuthForm({ className, action, ...props }: UserAuthFormProps) {
  const router = useRouter()
  const pathname = usePathname()
  const [name, setName] = React.useState('')
  const [isLoading, setIsLoading] = React.useState<boolean>(false)

  const { createRoom, joinRoom, roomCode } = usePlanning() 

  async function onSubmit(event: React.SyntheticEvent) {
    event.preventDefault()
    setIsLoading(true)

    if (!roomCode) {
      createRoom(name)
    } else {
      joinRoom(name, roomCode)
    }
  }

  React.useEffect(() => {
    if (roomCode && pathname === '/') {
      router.replace(`/${roomCode}`)
    }
  }, [roomCode])

  return (
    <div className={cn("grid gap-6", className)} {...props}>
      <form onSubmit={onSubmit}>
        <div className="grid gap-2">
          <div className="grid gap-1">
            <Label className="sr-only" htmlFor="name">
              Name
            </Label>
            <Input
              id="name"
              type="text"
              autoCapitalize="none"
              autoCorrect="off"
              disabled={isLoading}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <Button disabled={isLoading}>
            {isLoading && (
              <Icons.spinner className="mr-2 h-4 w-4 animate-spin" />
            )}
            {action}
          </Button>
        </div>
      </form>
    </div>
  )
}