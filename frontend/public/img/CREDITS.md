# Créditos das imagens

## Situação atual

As capas de curso são **imagens fornecidas pelo dono do projeto**, entregues a
partir de `~/OneDrive/Imagens/Screenshots/NR 06.png`, `NR 12.png`, `NR 18.png` e
`NR 35.png`.

Cada PNG foi recortado no centro para 16:9 e convertido em JPEG 960x540 com
qualidade 85. Os originais ficam intactos na pasta de origem — o backup das
versões anteriores (fotos do StockSnap) está em `%TEMP%\opencode\stocksnap-backup`.

> ⚠️ **A licença dessas imagens é responsabilidade de quem as forneceu.** Nenhuma
> verificação de direitos autorais foi feita: confirme que você tem permissão para
> usá-las comercialmente antes de publicar o site.

| Arquivo | Curso | Origem | Tamanho do original |
| --- | --- | --- | --- |
| `nr06-epi.jpg` | NR 06 - EPI | `NR 06.png` | 509 x 341 |
| `nr12-maquinas.jpg` | NR 12 - Máquinas e Equipamentos | `NR 12.png` | 510 x 342 |
| `nr18-construcao.jpg` | NR 18 - Construção Civil | `NR 18.png` | 513 x 345 |
| `nr35-alturas.jpg` | NR 35 - Trabalho em Alturas | `NR 35.png` | 509 x 345 |

## Ressalva sobre resolução

Os originais têm cerca de **510 px de largura**. Para os cards do catálogo isso
basta, mas o `HeroCarousel` da home estica a capa para a largura da tela — em
monitores grandes a imagem aparece ampliada e borrada. Se isso incomodar, troque
por arquivos de no mínimo 1600 px de largura, mantendo os mesmos nomes.

## Versões anteriores (StockSnap, CC0)

Foram substituídas, mas ficaram registradas aqui caso queira voltar:

| Curso | Foto | Licença |
| --- | --- | --- |
| NR 06 | [Workers Helmets](https://stocksnap.io/photo/workers-helmets-AKN7QEXRDB) | CC0 1.0 |
| NR 12 | [Workbench Machinery](https://stocksnap.io/photo/workbench-machinery-RKR8CFTODQ) | CC0 1.0 |
| NR 18 | [Building Construction](https://stocksnap.io/photo/building-construction-Q309TP8KY1) | CC0 1.0 |
| NR 35 | [Ladder Steps](https://stocksnap.io/photo/ladder-steps-342C971556) | CC0 1.0 |

## Como trocar

Substitua o arquivo em `frontend/public/img/` mantendo o nome, ou aponte `cover`
no seed (`backend/src/db/seed.js`) para outro caminho. A coluna `cover_url` é texto
livre e não valida a origem.
