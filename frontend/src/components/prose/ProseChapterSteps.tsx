import { Steps } from 'antd';
import { PROSE_STEPS } from './prose-ui-state';

export function ProseChapterSteps({
  number,
  step,
  failed,
  reviewBlocked,
  overridden,
}: {
  number: number;
  step: number;
  failed: boolean;
  reviewBlocked: boolean;
  overridden: boolean;
}) {
  return (
    <div className="prose-steps" role="group" aria-label={`第 ${number} 章创作进度`}>
      <Steps
        size="small"
        current={step}
        status={failed ? 'error' : 'process'}
        items={PROSE_STEPS.map((title, index) => ({
          title: <span aria-current={index === step ? 'step' : undefined}>{title}</span>,
          description:
            index === step && failed
              ? '失败'
              : index === 1 && reviewBlocked
                ? '待处理'
                : index === 1 && overridden
                  ? '作者已放行'
                  : undefined,
          status: index === 4 && step === 4 ? 'finish' : undefined,
        }))}
      />
    </div>
  );
}
