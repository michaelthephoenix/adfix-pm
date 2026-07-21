import { useEffect, useState } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { CalendarDays, GripVertical, MessageSquare, UserRound } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { formatLabel, type Task, taskPhases } from "./model";

function getStatusActions(task: Task) {
  if (task.status === "pending") return [{ status: "in_progress" as const, label: "Start" }];
  if (task.status === "in_progress") {
    return [
      ...(task.deliverable_required ? [] : [{ status: "completed" as const, label: "Complete" }]),
      { status: "blocked" as const, label: "Block" }
    ];
  }
  if (task.status === "blocked") return [{ status: "in_progress" as const, label: "Resume" }];
  return [];
}

function getTaskBadgeClass(kind: "status" | "priority", value: string) {
  const normalized = value.replaceAll("_", "-");
  return `badge badge-${kind} badge-${kind}-${normalized}`;
}

type TaskAssignee = Task["assignees"][number];

function getAssigneeInitials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part.charAt(0).toUpperCase()).join("") || "?";
}

function getAssigneeTone(name: string) {
  const checksum = Array.from(name).reduce((total, character) => total + character.charCodeAt(0), 0);
  return checksum % 5;
}

function AssigneeAvatar({ assignee, stackOrder }: { assignee: TaskAssignee; stackOrder: number }) {
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => setImageFailed(false), [assignee.avatar_url]);

  if (assignee.avatar_url && !imageFailed) {
    return <img className="task-assignee-avatar" src={assignee.avatar_url} alt="" title={assignee.name} style={{ zIndex: stackOrder }} onError={() => setImageFailed(true)} />;
  }

  return (
    <span className={`task-assignee-avatar task-assignee-avatar-fallback task-assignee-avatar-tone-${getAssigneeTone(assignee.name)}`} title={assignee.name} style={{ zIndex: stackOrder }}>
      {getAssigneeInitials(assignee.name)}
    </span>
  );
}

function TaskAssigneeGroup({ task }: { task: Task }) {
  const assignees = task.assignees ?? [];
  if (assignees.length === 0) return <span className="task-assignee-empty"><UserRound size={13} /> Unassigned</span>;

  const visibleAssignees = assignees.slice(0, 3);
  const surplus = assignees.length - visibleAssignees.length;
  const assigneeNames = assignees.map((assignee) => assignee.name).join(", ");
  const surplusNames = assignees.slice(3).map((assignee) => assignee.name).join(", ");

  return (
    <span className="task-assignee-group" role="img" aria-label={`Assigned to ${assigneeNames}`}>
      <span className="task-assignee-stack" aria-hidden="true">
        {visibleAssignees.map((assignee, index) => <AssigneeAvatar key={assignee.id} assignee={assignee} stackOrder={visibleAssignees.length - index + 1} />)}
        {surplus > 0 ? <span className="task-assignee-avatar task-assignee-surplus" title={surplusNames} style={{ zIndex: 1 }}>+{surplus}</span> : null}
      </span>
    </span>
  );
}

type TaskCardProps = {
  task: Task;
  canWrite: boolean;
  selected: boolean;
  onToggleSelected: () => void;
  onOpen: () => void;
  onStatusChange: (status: Task["status"]) => void;
};

function TaskKanbanCard({ task, canWrite, selected, onToggleSelected, onOpen, onStatusChange }: TaskCardProps) {
  const draggable = useDraggable({ id: `task:${task.id}`, data: { task }, disabled: !canWrite });
  const overdue = Boolean(task.due_date && new Date(task.due_date).getTime() < Date.now() && task.status !== "completed");

  return (
    <article ref={draggable.setNodeRef} className={`task-kanban-card ${draggable.isDragging ? "dragging" : ""}`}>
      <div className="task-kanban-card-topline">
        <label className="task-select-control"><input type="checkbox" checked={selected} disabled={!canWrite} onChange={onToggleSelected} /><span className={`badge badge-priority badge-priority-${task.priority}`}>{task.priority}</span></label>
        <button className="drag-handle" type="button" aria-label={`Move ${task.title}`} disabled={!canWrite} {...draggable.listeners} {...draggable.attributes}><GripVertical size={16} /></button>
      </div>
      <button type="button" className="task-kanban-title" onClick={onOpen}>{task.title}</button>
      {(task.labels?.length ?? 0) > 0 ? <div className="task-card-labels" aria-label="Task labels">{task.labels.slice(0, 3).map((label) => <span key={label.id ?? label.name} className={`task-label task-label-${label.color}`}>{label.name}</span>)}{task.labels.length > 3 ? <span className="task-label task-label-more">+{task.labels.length - 3}</span> : null}</div> : null}
      <span className={getTaskBadgeClass("status", task.status)}>{formatLabel(task.status)}</span>
      <div className="task-kanban-meta"><span className={overdue ? "deadline-overdue" : ""}><CalendarDays size={13} /> {task.due_date ? new Date(task.due_date).toLocaleDateString() : "No due date"}</span><TaskAssigneeGroup task={task} /></div>
      <div className="task-kanban-actions">
        {getStatusActions(task).map((action) => <Button key={action.status} variant="ghost" size="sm" disabled={!canWrite} onClick={() => onStatusChange(action.status)}>{action.label}</Button>)}
        <Button variant="ghost" size="sm" icon={<MessageSquare size={13} />} onClick={onOpen}>Details</Button>
      </div>
    </article>
  );
}

export function TaskDragPreview({ task }: { task: Task }) {
  return (
    <article className="task-kanban-card task-drag-overlay" aria-hidden="true">
      <div className="task-kanban-card-topline"><span className={`badge badge-priority badge-priority-${task.priority}`}>{task.priority}</span><GripVertical size={16} /></div>
      <div className="task-kanban-title">{task.title}</div>
      <span className={getTaskBadgeClass("status", task.status)}>{formatLabel(task.status)}</span>
      {(task.labels?.length ?? 0) > 0 ? <div className="task-card-labels">{task.labels.slice(0, 2).map((label) => <span key={label.id ?? label.name} className={`task-label task-label-${label.color}`}>{label.name}</span>)}</div> : null}
      <div className="task-kanban-meta"><TaskAssigneeGroup task={task} /></div>
    </article>
  );
}

type TaskPhaseColumnProps = {
  phase: (typeof taskPhases)[number];
  tasks: Task[];
  canWrite: boolean;
  selectedTaskIds: string[];
  onToggleSelected: (taskId: string) => void;
  onOpenTask: (taskId: string) => void;
  onStatusChange: (taskId: string, status: Task["status"]) => void;
};

export function TaskPhaseColumn({ phase, tasks, canWrite, selectedTaskIds, onToggleSelected, onOpenTask, onStatusChange }: TaskPhaseColumnProps) {
  const droppable = useDroppable({ id: phase.id });
  return (
    <section ref={droppable.setNodeRef} className={`task-phase-column phase-${phase.id} ${droppable.isOver ? "drop-target" : ""}`}>
      <header className="task-phase-column-header"><span className="phase-dot" /><h3>{phase.label}</h3><span className="phase-count">{tasks.length}</span></header>
      <div className="task-phase-column-body">
        {tasks.map((task) => <TaskKanbanCard key={task.id} task={task} canWrite={canWrite} selected={selectedTaskIds.includes(task.id)} onToggleSelected={() => onToggleSelected(task.id)} onOpen={() => onOpenTask(task.id)} onStatusChange={(status) => onStatusChange(task.id, status)} />)}
        {tasks.length === 0 ? <p className="phase-empty">Drop a task here</p> : null}
      </div>
    </section>
  );
}
