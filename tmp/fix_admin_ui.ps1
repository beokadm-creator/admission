$f = "src/pages/admin/SchoolSettings.tsx"
$c = Get-Content -Path $f -Raw

# 1. Update Program Info Label and add Image URL field
$oldProgram = '<Field label="프로그램 안내">'
$newProgram = '<Field label="프로그램 안내 (텍스트)">'
$c = $c.Replace($oldProgram, $newProgram)

# Insert program image URL after program info Field block
# We look for the closing </Field> of program info.
# It's unique enough if we include more context.
$searchString = 'placeholder="예: 사전 준비물, 행사 소개, 유의사항 등을 안내합니다."'
$insertAfter = '/>
                  </Field>'
$insertedText = '
                  <Field label="프로그램 안내 이미지 URL" hint="게이트 페이지의 ''프로그램 보기'' 팝업에 노출될 이미지 주소입니다.">
                    <input {...register(''programImageUrl'')} type="url" className={inputClassName} placeholder="https://..." />
                  </Field>'
$c = $c -replace 'placeholder="예: 사전 준비물, 행사 소개, 유의사항 등을 안내합니다."\s+/>\s+</Field>', ('placeholder="예: 사전 준비물, 행사 소개, 유의사항 등을 안내합니다." />' + "`n" + '                  </Field>' + $insertedText)

# 2. Add Grade Options Textarea
$searchGrade = 'label="학년" }'
$insertGradeAfter = '</span>
                      </label>'
$insertedGradeText = '
                    <div className="mt-4 pt-4 border-t border-gray-100">
                      <Field label="학년 선택 옵션" hint="Enter를 눌러 한 줄에 하나씩 입력해 주세요. (예: 예비1학년)">
                        <textarea
                          {...register(''formFields.gradeOptionsText'' as any)}
                          rows={4}
                          className={textareaClassName}
                          placeholder="예비1학년\n예비2학년\n예비3학년"
                        />
                      </Field>
                    </div>'
# This one is trickier due to the map.
# I'll just append it after the map loop closing brace.
$c = $c -replace '(?s)label: ''주소'' \}\s+].map.*?</span>\s+</label>\s+\)\)\);', "$&`n`n$insertedGradeText"

Set-Content -Path $f -Value $c -Encoding utf8
