import { PagePanel } from '../../shared/ui/PagePanel'
import { AiRenameSettingsForm } from './AiRenameSettingsForm'

export function AiRenamePage() {
  return (
    <PagePanel
      className="ai-rename-panel"
      compact
      eyebrow="AI Rename"
      subtitle="配置 AI 接口、命名规则、分析提示词和 TMDB 校验；任务运行请前往 AI 重命名任务管理。"
      title="AI 自动重命名"
    >
      <div className="ai-rename-settings-page">
        <AiRenameSettingsForm />
      </div>
    </PagePanel>
  )
}
