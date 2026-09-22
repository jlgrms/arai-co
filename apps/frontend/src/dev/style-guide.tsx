/**
 * DEV-ONLY STYLE REFERENCE PAGE — /dev/style-guide
 *
 * Purpose: verification-only surface for the design system (Layer 5 exit criterion:
 * "Style reference page renders all tokens/typography/components correctly").
 *
 * NOT linked in any production navigation. Do not import into patient/doctor/admin
 * shells. Kept in src/dev to make its non-production status obvious.
 */
import { toast } from 'sonner';
import { AlertTriangle, Bell, Check, Info, Mail, Trash2 } from 'lucide-react';

import { BrandLogo } from '@/components/brand/logo';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Toaster } from '@/components/ui/sonner';

const palette = [
  // ARAI.CO v3 tokens. This list mirrors arai-design-guideline-v3.md exactly —
  // if a hex and its token drift apart, the guideline wins.
  { name: 'ink', hex: '#132B3E', var: '--ink' },
  { name: 'ink-muted', hex: '#536979', var: '--ink-muted' },
  { name: 'ink-faint', hex: '#7D8D97', var: '--ink-faint' },
  { name: 'brand-coral', hex: '#FF705B', var: '--brand-coral' },
  { name: 'brand-coral-dark', hex: '#E75A46', var: '--brand-coral-dark' },
  { name: 'brand-mint', hex: '#DFF7EC', var: '--brand-mint' },
  { name: 'accent-green', hex: '#BDEBD2', var: '--accent-green' },
  { name: 'accent-peach', hex: '#FFE0D2', var: '--accent-peach' },
  { name: 'accent-yellow', hex: '#FFD166', var: '--accent-yellow' },
  { name: 'accent-blue', hex: '#118AB2', var: '--accent-blue' },
  { name: 'surface-page', hex: '#F5F8F6', var: '--surface-page' },
  { name: 'surface-card', hex: '#FFFFFF', var: '--surface-card' },
  { name: 'border-default', hex: '#DDE7E2', var: '--border-default' },
  { name: 'status-success', hex: '#07875F', var: '--status-success' },
  { name: 'status-danger', hex: '#C9473C', var: '--status-danger' },
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <div className="flex items-center gap-3">
        <h2 className="font-heading text-xl font-semibold text-ink">{title}</h2>
        <Separator className="flex-1" />
      </div>
      {children}
    </section>
  );
}

function Swatch({ name, hex, cssVar }: { name: string; hex: string; cssVar: string }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface">
      <div className="h-16 w-full" style={{ backgroundColor: `var(${cssVar})` }} />
      <div className="space-y-0.5 p-3">
        <p className="text-xs font-medium text-ink">{name}</p>
        <p className="font-mono text-[11px] text-muted-foreground">{hex}</p>
      </div>
    </div>
  );
}

export default function StyleGuidePage() {
  return (
    <div className="min-h-screen bg-background p-8">
      <Toaster />
      <div className="mx-auto max-w-5xl space-y-12">
        <header className="space-y-3">
          <BrandLogo size="lg" />
          <div>
            <h1 className="font-heading text-3xl font-bold text-ink">Design system reference</h1>
            <p className="text-sm text-muted-foreground">
              Verification-only. Not linked in production navigation.
            </p>
          </div>
        </header>

        <Section title="Color tokens">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {palette.map((c) => (
              <Swatch key={c.name} name={c.name} hex={c.hex} cssVar={c.var} />
            ))}
          </div>
        </Section>

        <Section title="Typography">
          <div className="space-y-3 rounded-xl border border-border bg-surface p-6">
            <p className="font-heading text-4xl font-bold text-ink">Manrope Bold — H1</p>
            <p className="font-heading text-2xl font-semibold text-ink">Manrope Semibold — H2</p>
            <p className="font-heading text-xl font-semibold text-ink">Manrope Semibold — H3</p>
            <p className="font-body text-base text-ink">
              Inter Regular — body text. The quick brown fox jumps over the lazy dog.
            </p>
            <p className="font-body text-sm text-muted-foreground">
              Inter Regular — small muted text for secondary information.
            </p>
            <p className="font-mono text-sm text-ink">mono — timestamps, ids, code</p>
          </div>
        </Section>

        <Section title="Buttons">
          <div className="space-y-4 rounded-xl border border-border bg-surface p-6">
            <div className="flex flex-wrap items-center gap-3">
              <Button>Default (ink)</Button>
              <Button variant="outline">Outline</Button>
              <Button variant="secondary">Secondary</Button>
              <Button variant="ghost">Ghost</Button>
              <Button variant="link">Link</Button>
              <Button variant="destructive">
                <Trash2 /> Destructive
              </Button>
            </div>
            <Separator />
            <div>
              <p className="mb-2 text-xs font-medium text-muted-foreground">
                Single hero CTA — red, large + bold only (AA-compliant at this size)
              </p>
              <Button variant="cta" size="xl">
                Book a consultation
              </Button>
            </div>
            <Separator />
            <div className="flex flex-wrap items-center gap-3">
              <Button size="sm">Small</Button>
              <Button size="default">Default</Button>
              <Button size="lg">Large</Button>
              <Button disabled>Disabled</Button>
              <Button size="icon" aria-label="Notifications">
                <Bell />
              </Button>
            </div>
          </div>
        </Section>

        <Section title="Badges">
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface p-6">
            <Badge>Default</Badge>
            <Badge variant="secondary">Secondary</Badge>
            <Badge variant="outline">Outline</Badge>
            <Badge variant="success">Active</Badge>
            <Badge variant="danger">Suspended</Badge>
            <Badge variant="muted">Deactivated</Badge>
          </div>
        </Section>

        <Section title="Form controls">
          <div className="max-w-sm space-y-4 rounded-xl border border-border bg-surface p-6">
            <div className="space-y-2">
              <Label htmlFor="sg-email">Email</Label>
              <Input id="sg-email" type="email" placeholder="you@example.com" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sg-invalid">Invalid state</Label>
              <Input id="sg-invalid" aria-invalid placeholder="Required" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sg-disabled">Disabled</Label>
              <Input id="sg-disabled" disabled placeholder="Disabled" />
            </div>
          </div>
        </Section>

        <Section title="Card">
          <Card className="max-w-md">
            <CardHeader>
              <CardTitle>Dr. Marisol Reyes</CardTitle>
              <CardDescription>Cardiology · 12 yrs experience</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-ink">Next available: Tomorrow, 9:00 AM</p>
            </CardContent>
            <CardFooter className="gap-2">
              <Button size="sm">Book</Button>
              <Button size="sm" variant="outline">
                View profile
              </Button>
            </CardFooter>
          </Card>
        </Section>

        <Section title="Avatar">
          <div className="flex items-center gap-3 rounded-xl border border-border bg-surface p-6">
            <Avatar>
              <AvatarFallback>MR</AvatarFallback>
            </Avatar>
            <Avatar className="h-12 w-12">
              <AvatarFallback>JD</AvatarFallback>
            </Avatar>
          </div>
        </Section>

        <Section title="Tabs">
          <Tabs defaultValue="upcoming" className="max-w-md">
            <TabsList>
              <TabsTrigger value="upcoming">Upcoming</TabsTrigger>
              <TabsTrigger value="past">Past</TabsTrigger>
              <TabsTrigger value="cancelled">Cancelled</TabsTrigger>
            </TabsList>
            <TabsContent value="upcoming" className="text-sm text-muted-foreground">
              Upcoming appointments list renders here.
            </TabsContent>
            <TabsContent value="past" className="text-sm text-muted-foreground">
              Past appointments render here.
            </TabsContent>
            <TabsContent value="cancelled" className="text-sm text-muted-foreground">
              Cancelled appointments render here.
            </TabsContent>
          </Tabs>
        </Section>

        <Section title="Alerts">
          <div className="space-y-3">
            <Alert>
              <Info />
              <AlertTitle>Heads up</AlertTitle>
              <AlertDescription>Neutral inline alert.</AlertDescription>
            </Alert>
            <Alert variant="success">
              <Check />
              <AlertTitle>Appointment confirmed</AlertTitle>
              <AlertDescription>Your booking is set for tomorrow at 9:00 AM.</AlertDescription>
            </Alert>
            <Alert variant="destructive">
              <AlertTriangle />
              <AlertTitle>Account suspended</AlertTitle>
              <AlertDescription>Contact support to restore access.</AlertDescription>
            </Alert>
          </div>
        </Section>

        <Section title="Dialog & Alert dialog">
          <div className="flex flex-wrap gap-3 rounded-xl border border-border bg-surface p-6">
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="outline">Open dialog</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Reschedule appointment</DialogTitle>
                  <DialogDescription>
                    Pick a new slot. Your doctor will be notified.
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <Button variant="outline">Cancel</Button>
                  <Button>Confirm</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive">Cancel appointment</Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Cancel this appointment?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This can't be undone. The slot will be released.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep it</AlertDialogCancel>
                  <AlertDialogAction>Yes, cancel</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </Section>

        <Section title="Dropdown menu">
          <div className="rounded-xl border border-border bg-surface p-6">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline">
                  <Mail /> Account
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuLabel>Signed in as</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem>Profile</DropdownMenuItem>
                <DropdownMenuItem>Settings</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem>Sign out</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </Section>

        <Section title="Table">
          <div className="rounded-xl border border-border bg-surface">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Patient</TableHead>
                  <TableHead>Doctor</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Scheduled</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell>Juan Dela Cruz</TableCell>
                  <TableCell>Dr. Marisol Reyes</TableCell>
                  <TableCell>
                    <Badge variant="success">Completed</Badge>
                  </TableCell>
                  <TableCell>Aug 12, 9:00 AM</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>Ana Santos</TableCell>
                  <TableCell>Dr. Ben Ocampo</TableCell>
                  <TableCell>
                    <Badge variant="muted">Cancelled</Badge>
                  </TableCell>
                  <TableCell>Aug 14, 2:30 PM</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </Section>

        <Section title="Skeleton (loading)">
          <div className="flex items-center gap-3 rounded-xl border border-border bg-surface p-6">
            <Skeleton className="h-12 w-12 rounded-full" />
            <div className="space-y-2">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-4 w-32" />
            </div>
          </div>
        </Section>

        <Section title="Separator">
          <div className="rounded-xl border border-border bg-surface p-6">
            <p className="text-sm text-ink">Above</p>
            <Separator className="my-4" />
            <p className="text-sm text-ink">Below</p>
          </div>
        </Section>

        <Section title="Toast (sonner)">
          <div className="flex flex-wrap gap-3 rounded-xl border border-border bg-surface p-6">
            <Button variant="outline" onClick={() => toast('Appointment booked!')}>
              Neutral toast
            </Button>
            <Button
              variant="outline"
              onClick={() => toast.success('Saved', { description: 'Profile updated.' })}
            >
              Success toast
            </Button>
            <Button
              variant="outline"
              onClick={() => toast.error('Booking failed', { description: 'Slot taken.' })}
            >
              Error toast
            </Button>
          </div>
        </Section>

        <Section title="Logo mark">
          <div className="flex flex-wrap items-start gap-6 rounded-xl border border-border bg-surface p-6">
            <div>
              <p className="mb-2 text-xs text-muted-foreground">Light (default) — header/footer</p>
              <BrandLogo size="lg" />
            </div>
            <div>
              <p className="mb-2 text-xs text-muted-foreground">Outline — dark sidebar</p>
              <span className="inline-flex items-center rounded-lg bg-ink px-3 py-2">
                <BrandLogo variant="outline" size="lg" />
              </span>
            </div>
            <div>
              <p className="mb-2 text-xs text-muted-foreground">Sizes (sm / md / lg)</p>
              <div className="flex items-center gap-4">
                <BrandLogo size="sm" />
                <BrandLogo size="md" />
                <BrandLogo size="lg" />
              </div>
            </div>
          </div>
        </Section>
      </div>
    </div>
  );
}
