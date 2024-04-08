async function process(jobs) {
    try {
        const job = Array.isArray(jobs) ? jobs[0] : jobs;
        const {
            application_id: applicationId,
            queue_name: queueName,
            draft_transaction_data,
            job_name: jobName
        } = job.data;

        const queue = this.queues.getQueue(queueName);

        if (queueName === 'failed-transactions' && job.data.event_type === 'kafene.charge.updated') {

            const succeededDelayedJobId = `bull:worker-balancer:${job.data.application_id}-${job.data.stripe_transaction_id}-${job.data.charge_id}-delayed`;
            const succeededEvent = await this.redis.hgetall(succeededDelayedJobId);
            await this.redis.del(succeededDelayedJobId);

            if (job.data.failed_reason.failure_code === 'R06' && succeededEvent?.data) {
                const parsedEvent = JSON.parse(succeededEvent.data);

                const paidQueue = this.queues.getQueue(parsedEvent.queue_name);

                const succeededJobId = `${job.data.application_id}-${job.data.stripe_transaction_id}-${job.data.charge_id}`;
                const targetJob = await paidQueue.add(parsedEvent, {
                    jobId: succeededJobId
                });

                this.attachQueueProcessListeners(targetJob, {
                    draft_transaction_data: targetJob.data.draft_transaction_data,
                    queue_name: parsedEvent.queue_name,
                    job: targetJob,
                    applicationId
                });
            }
        }

        // TEMP FIX - not all transaction have application_id - need to fix it
        if (applicationId) {
            const isCurrentlyProcessed = await this.redis.get(applicationId);
            if (isCurrentlyProcessed) {
                // need A NEW JOB ID in order to put it back into queue
                await this.workerBalancerQueue.add(job.data, {
                    jobId: this.addSuffixToJobId(job.id),
                    delay: 90 * 1000 // 90 sec in milisecs
                });
                return { result: { message: `Delayed job ${job.id}` } };
            }

            //  fallback - ttl to not hold value indefinitely in redis
            await this.redis.setWithTtl({
                key: applicationId,
                value: 1,
                seconds: 60
            });
        }

        const targetJob = jobName
            ? await queue.add(jobName, job.data, {
                jobId: job.id,
                  removeOnComplete: 1000, // keeping the last 1000 successful jobs (deleting others)
                  removeOnFail: 3000 // keeping the last 3000 failed jobs (deleting others)
            })
            : await queue.add(job.data, {
                jobId: job.id
            });

        this.attachQueueProcessListeners(targetJob, {
            draft_transaction_data,
            queue_name: queueName,
            job,
            applicationId
        });

        return { result: { message: `Passed to ${queueName}` } };
    } catch (error) {
        this.logger.error('Worker-balancer error:', error);
        return { result: error };
    }
}


const handleModernTreasuryFailureCase = async(job) => {
    const succeededDelayedJobId = `bull:worker-balancer:${job.data.application_id}-${job.data.stripe_transaction_id}-${job.data.charge_id}-delayed`;
    const succeededEvent = await this.redis.hgetall(succeededDelayedJobId);
    await this.redis.del(succeededDelayedJobId);

    if (job.data.failed_reason.failure_code === 'R06' && succeededEvent?.data) {
        const parsedEvent = JSON.parse(succeededEvent.data);

        const paidQueue = this.queues.getQueue(parsedEvent.queue_name);

        const succeededJobId = `${job.data.application_id}-${job.data.stripe_transaction_id}-${job.data.charge_id}`;
        const targetJob = await paidQueue.add(parsedEvent, {
            jobId: succeededJobId
        });

        this.attachQueueProcessListeners(targetJob, {
            draft_transaction_data: targetJob.data.draft_transaction_data,
            queue_name: parsedEvent.queue_name,
            job: targetJob,
            applicationId
        });
    }
}
